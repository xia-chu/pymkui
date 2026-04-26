"""
流转推插件（on_media_changed）

当媒体源注册（上线）时，调用 ZLM addStreamPusherProxy 开始转推；
当媒体源注销（下线）时，调用 ZLM delStreamPusherProxy 停止转推。

支持：
  - rtsp / rtmp 目标推流（根据 dst_url 的 schema 自动识别）
  - vhost / app / stream / schema 来源过滤（支持通配符 *）
  - 目标 URL 变量替换：{vhost} {app} {stream}
  - multi_binding=True：可多次绑定，每实例推往不同目标
"""

import fnmatch
import threading
import httpx
import asyncio
import mk_loader
import mk_logger
from py_plugin import PluginBase
from shared_loop import SharedLoop


# ── 全局推流状态表 ────────────────────────────────────────────────────
# state_key → ZLM pusher key（addStreamPusherProxy 返回的 data.key）
_pusher_keys: dict = {}
_lock = threading.Lock()


def _zlm_base_url() -> str:
    """获取 ZLM 本机访问地址"""
    try:
        port = int(mk_loader.get_config("http.port") or 0)
        if port:
            return f"http://127.0.0.1:{port}"
        ssl_port = mk_loader.get_config("http.ssl_port") or 443
        return f"https://127.0.0.1:{ssl_port}"
    except Exception:
        return "http://127.0.0.1:80"


def _zlm_secret() -> str:
    try:
        return mk_loader.get_config("api.secret") or ""
    except Exception:
        return ""


def _add_pusher(dst_schema: str, vhost: str, app: str, stream: str,
                dst_url: str, rtp_type: int,
                retry_count: int, timeout_sec: float):
    """
    调用 ZLM addStreamPusherProxy，同步等待回复并返回key。
    """
    params = {
        "secret":   _zlm_secret(),
        "schema":   dst_schema,
        "vhost":    vhost,
        "app":      app,
        "stream":   stream,
        "dst_url":  dst_url,
        "rtp_type": rtp_type,
    }
    if retry_count >= 0:
        params["retry_count"] = retry_count
    if timeout_sec > 0:
        params["timeout_sec"] = timeout_sec

    # 处理rtsps和rtmps协议，ZLM的addStreamPusherProxy接口只接受rtsp或rtmp
    zlm_schema = dst_schema
    if dst_schema == "rtsps":
        zlm_schema = "rtsp"
    elif dst_schema == "rtmps":
        zlm_schema = "rtmp"
    
    # 更新params中的schema
    params["schema"] = zlm_schema
    
    
    # 同步调用addStreamPusherProxy接口，等待响应
    api_url = f"{_zlm_base_url()}/index/api/addStreamPusherProxy"
    try:
        resp = httpx.get(api_url, params=params, timeout=10.0)
        data = resp.json()
        if data.get("code") == 0:
            # 从data字段中获取key
            zlm_key = data.get("data", {}).get("key")
            if zlm_key:
                mk_logger.log_info(
                    f"[stream_pusher] 转推已启动 {vhost}/{app}/{stream} → {dst_url}  key={zlm_key}"
                )
                return zlm_key
            else:
                # 如果ZLM没有返回key，使用我们自己生成的key
                mk_logger.log_info(
                    f"[stream_pusher] 转推已启动 {vhost}/{app}/{stream} → {dst_url}  key={key} (ZLM未返回key)")
                return None
        else:
            mk_logger.log_warn(
                f"[stream_pusher] addStreamPusherProxy 失败: code={data.get('code')} "
                f"msg={data.get('msg')}  {vhost}/{app}/{stream} → {dst_url}"
            )
            return None
    except Exception as e:
        mk_logger.log_warn(f"[stream_pusher] addStreamPusherProxy 请求异常: {e}")
        return None


def _del_pusher(key: str):
    """调用 ZLM delStreamPusherProxy 停止转推，同步等待回复"""
    api_url = f"{_zlm_base_url()}/index/api/delStreamPusherProxy"
    params = {"secret": _zlm_secret(), "key": key}
    try:
        resp = httpx.get(api_url, params=params, timeout=10.0)
        data = resp.json()
        if data.get("code") == 0:
            mk_logger.log_info(f"[stream_pusher] 转推已停止 key={key}")
        else:
            mk_logger.log_warn(
                f"[stream_pusher] delStreamPusherProxy 失败: code={data.get('code')} "
                f"msg={data.get('msg')}  key={key}"
            )
    except Exception as e:
        mk_logger.log_warn(f"[stream_pusher] delStreamPusherProxy 请求异常: {e}")


# ── 插件类 ────────────────────────────────────────────────────────────

class StreamPusher(PluginBase):
    name        = "stream_pusher"
    version     = "1.0.0"
    description = (
        "流转推插件（on_media_changed）。"
        "流上线时自动调用 ZLM addStreamPusherProxy 转推到目标地址，"
        "流下线时调用 delStreamPusherProxy 停止转推。"
        "支持 rtsp/rtmp 目标，目标 URL 支持 {vhost}/{app}/{stream} 变量替换。"
    )
    type          = "on_media_changed"
    interruptible = False   # 监听型：不拦截事件，继续派发后续插件
    multi_binding = True    # 支持多实例，每实例独立推往不同目标

    def params(self) -> dict:
        return {
            "dst_url": {
                "type": "str",
                "description": (
                    "目标转推地址，必须以 rtsp:// 或 rtmp:// 开头。"
                    "支持变量：{vhost} {app} {stream}，"
                    "例如：rtmp://relay.example.com/live/{stream}"
                ),
                "default": "",
            },
            "rtp_type": {
                "type": "int",
                "description": "RTSP 推流传输方式：0=TCP，1=UDP",
                "default": 0,
            },
            "retry_count": {
                "type": "int",
                "description": "推流失败重试次数，-1 无限重试，0 不重试",
                "default": -1,
            },
            "timeout_sec": {
                "type": "float",
                "description": "推流超时时间（秒），0 使用 ZLM 默认值",
                "default": 0,
            },
            "vhost_filter": {
                "type": "str",
                "description": "来源 vhost 过滤，支持通配符 *，默认匹配所有",
                "default": "*",
            },
            "app_filter": {
                "type": "str",
                "description": "来源 app 过滤，支持通配符 *，默认匹配所有",
                "default": "*",
            },
            "stream_filter": {
                "type": "str",
                "description": "来源 stream 过滤，支持通配符 *，默认匹配所有",
                "default": "*",
            },
        }

    def run(self, **kwargs) -> bool:
        is_register: bool    = kwargs.get("is_register", False)
        sender               = kwargs.get("sender")
        binding_params: dict = kwargs.get("binding_params") or {}

        if sender is None:
            return False

        # 同步获取来源流信息（sender是临时对象，不可在异步协程中引用）
        try:
            src_schema = sender.getSchema()
            mt     = sender.getMediaTuple()
            vhost  = mt.vhost
            app    = mt.app
            stream = mt.stream
        except Exception as e:
            mk_logger.log_warn(f"[stream_pusher] 获取流信息异常: {e}")
            return False

        # 读取绑定参数（优先实例参数，缺省取 params() 默认值）
        p = self.params()
        def _get(key):
            return binding_params.get(key, p[key]["default"])

        dst_url_tpl   = str(_get("dst_url")).strip()
        rtp_type      = int(_get("rtp_type"))
        retry_count   = int(_get("retry_count"))
        timeout_sec   = float(_get("timeout_sec"))
        vhost_filter  = str(_get("vhost_filter")  or "*")
        app_filter    = str(_get("app_filter")    or "*")
        stream_filter = str(_get("stream_filter") or "*")

        if not dst_url_tpl:
            return False

        # ── 来源过滤 ──
        if not fnmatch.fnmatch(vhost,  vhost_filter):  return False
        if not fnmatch.fnmatch(app,    app_filter):    return False
        if not fnmatch.fnmatch(stream, stream_filter): return False
        
        # ── 根据推流URL协议类型自动过滤事件 ──
        # 提取目标协议
        dst_schema = dst_url_tpl.split("://")[0].lower() if "://" in dst_url_tpl else ""
        if dst_schema in ("rtsp", "rtsps"):
            # 如果推流URL是RTSP(S)，则只处理RTSP来源事件
            if src_schema.lower() != "rtsp":
                return False
        elif dst_schema in ("rtmp", "rtmps"):
            # 如果推流URL是RTMP(S)，则只处理RTMP来源事件
            if src_schema.lower() != "rtmp":
                return False

        # ── 变量替换生成实际目标 URL ──
        dst_url = (dst_url_tpl
                   .replace("{vhost}",  vhost)
                   .replace("{app}",    app)
                   .replace("{stream}", stream))

        # ── 提取目标协议 ──
        dst_schema = dst_url.split("://")[0].lower() if "://" in dst_url else ""
        if dst_schema not in ("rtsp", "rtsps", "rtmp", "rtmps"):
            mk_logger.log_warn(
                f"[stream_pusher] 不支持的目标协议 '{dst_schema}'，"
                f"dst_url={dst_url}，请使用 rtsp://、rtsps://、rtmp:// 或 rtmps:// 开头"
            )
            return False

        # 状态 key：模板 URL + 流标识，唯一标识一个推流任务
        state_key = f"{dst_url_tpl}|{vhost}|{app}|{stream}"

        # 创建异步协程来执行实际的HTTP调用（不引用sender对象）
        async def _async_run():
            if is_register:
                with _lock:
                    if state_key in _pusher_keys:
                        mk_logger.log_info(
                            f"[stream_pusher] 推流已存在，跳过重复启动 "
                            f"{vhost}/{app}/{stream} → {dst_url}"
                        )
                        return

                zlm_key = _add_pusher(
                    dst_schema, vhost, app, stream,
                    dst_url, rtp_type, retry_count, timeout_sec
                )
                if zlm_key:
                    with _lock:
                        _pusher_keys[state_key] = zlm_key
            else:
                with _lock:
                    zlm_key = _pusher_keys.pop(state_key, None)
                if zlm_key:
                    _del_pusher(zlm_key)
                else:
                    mk_logger.log_info(
                        f"[stream_pusher] 流下线，未找到对应推流记录（已停止或未曾启动）"
                        f" {vhost}/{app}/{stream}"
                    )

        # 使用SharedLoop在后台执行异步协程
        loop = SharedLoop.get_loop()
        asyncio.run_coroutine_threadsafe(_async_run(), loop)
        
        return False  # 监听型，始终不拦截后续插件
