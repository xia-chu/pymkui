import os
import sys
import json
import shutil
import subprocess
import mk_logger
import mk_loader
import asyncio
import py_plugin

from shared_loop import SharedLoop
from py_http_api import app, db
from starlette.routing import Match

def submit_coro(scope, body, send):
    async def run():
        # 包装 send 函数，确保它总是可等待的
        async def async_send(message):
            # 调用原始的 send 函数，它现在应该返回一个协程
            result = send(message)
            if result is not None:
                await result

        async def receive():
            return {
                "type": "http.request",
                "body": body,
                "more_body": False,
            }

        try:
            await app(scope, receive, async_send)
        except Exception as e:
            mk_logger.log_warn(f"FastAPI failed: {e}")
            # 发送错误响应
            await async_send({
                "type": "http.response.start",
                "status": 500,
                "headers": [(b"content-type", b"text/plain")],
            })
            await async_send({
                "type": "http.response.body",
                "body": b"Internal Server Error",
                "more_body": False,
            })
    return asyncio.run_coroutine_threadsafe(run(), SharedLoop.get_loop())

def check_route(scope) -> bool:
    for route in app.routes:
        if hasattr(route, "matches"):
            match, _ = route.matches(scope)
            if match == Match.FULL:
                return True
    return False

def _resolve_ffmpeg_bin(configured: str) -> str:
    """
    确保 ffmpeg 可执行文件路径有效。
    1. 若配置的路径存在且可执行，直接返回。
    2. 否则用 shutil.which 在 PATH 中查找（跨平台）。
    3. Unix 下额外尝试 whereis 作为补充。
    返回找到的路径，找不到返回空字符串。
    """
    # 1. 配置路径可用则直接返回
    if configured and os.path.isfile(configured) and os.access(configured, os.X_OK):
        mk_logger.log_info(f"[ffmpeg] 使用已配置路径: {configured}")
        return configured

    if configured:
        mk_logger.log_warn(f"[ffmpeg] 已配置路径不可用: {configured}，尝试自动查找")

    # 2. shutil.which（跨平台，Windows 自动追加 .exe）
    found = shutil.which("ffmpeg")
    if found:
        mk_logger.log_info(f"[ffmpeg] PATH 中找到: {found}")
        return found

    # 3. Unix 专属：whereis ffmpeg
    if sys.platform != "win32":
        try:
            out = subprocess.check_output(
                ["whereis", "-b", "ffmpeg"],
                stderr=subprocess.DEVNULL,
                timeout=5,
            ).decode().strip()
            # 输出格式: "ffmpeg: /usr/bin/ffmpeg ..."
            parts = out.split(":")
            if len(parts) >= 2:
                candidates = parts[1].split()
                for candidate in candidates:
                    if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                        mk_logger.log_info(f"[ffmpeg] whereis 找到: {candidate}")
                        return candidate
        except Exception as e:
            mk_logger.log_warn(f"[ffmpeg] whereis 查找失败: {e}")

    return ""


def on_start():
    py_plugin.load_plugins()
    
    mk_logger.log_info(f"on_start, secret: {mk_loader.get_config('api.secret')}")
    # 设置http.rootPath为当前py文件的../frontend目录
    current_dir = os.path.dirname(os.path.abspath(__file__))
    frontend_path = os.path.abspath(os.path.join(current_dir, '..', 'frontend'))
    mk_loader.set_config('http.rootPath', frontend_path)
    mk_logger.log_info(f"set http.rootPath to {frontend_path}")

    ffmpeg_bin = mk_loader.get_config('ffmpeg.bin')
    ffmpeg_bin = _resolve_ffmpeg_bin(ffmpeg_bin)
    if ffmpeg_bin:
        mk_loader.set_config('ffmpeg.bin', ffmpeg_bin)
        mk_logger.log_info(f"set ffmpeg.bin to {ffmpeg_bin}")
    else:
        mk_logger.log_warn("ffmpeg not found, ffmpeg.bin not set")

    mk_loader.update_config()
    mk_loader.set_fastapi(check_route, submit_coro)

    # 自动恢复非按需拉流代理
    _restore_pull_proxies()


def _restore_pull_proxies():
    """启动时从数据库读取所有 on_demand=0 的拉流代理，调用 mk_loader.add_stream_proxy 恢复"""
    try:
        proxies = db.get_all_pull_proxies()
    except Exception as e:
        mk_logger.log_warn(f"[restore_pull_proxies] 读取数据库失败: {e}")
        return

    count = 0
    for proxy in proxies:
        if proxy.get("on_demand", 0):
            # 按需拉流，跳过
            continue

        vhost = proxy.get("vhost") or "__defaultVhost__"
        app   = proxy.get("app", "")
        stream = proxy.get("stream", "")
        proxy_id = proxy.get("id")

        # 从多地址表取第一条地址
        proxy_urls = db.get_proxy_urls(proxy_id)
        first_url  = proxy_urls[0] if proxy_urls else {}
        url        = first_url.get("url", "")
        url_params = first_url.get("params", {})  # 已反序列化为 dict

        if not app or not stream or not url:
            mk_logger.log_warn(f"[restore_pull_proxies] 跳过无效记录 id={proxy_id}")
            continue

        vhost, app, stream, url, retry_count, timeout_sec, opt = _build_proxy_call_args(proxy, url, url_params)

        def make_callback(pid, vhost, app, stream, url):
            def cb(err, key):
                if err:
                    mk_logger.log_warn(f"[restore_pull_proxies] 恢复失败 id={pid} {vhost}/{app}/{stream}: {err}")
                else:
                    mk_logger.log_info(f"[restore_pull_proxies] 恢复成功 id={pid} {vhost}/{app}/{stream} url={url}")
            return cb

        mk_logger.log_info(
            f"[restore_pull_proxies] 恢复拉流代理 id={proxy_id} {vhost}/{app}/{stream} url={url} "
            f"retry_count={retry_count} timeout_sec={timeout_sec}"
        )
        mk_loader.add_stream_proxy(
            vhost,
            app,
            stream,
            url,
            make_callback(proxy_id, vhost, app, stream, url),
            retry_count=retry_count,
            force=True,
            timeout_sec=timeout_sec,
            opt=opt,
        )
        count += 1

    mk_logger.log_info(f"[restore_pull_proxies] 共恢复 {count} 个拉流代理")


def _build_proxy_call_args(proxy: dict, url: str = "", url_params: dict = {}) -> tuple:
    """
    从数据库代理记录中解析出 add_stream_proxy 所需的参数。
    url      由调用方从 pull_proxy_urls.url 取得后传入。
    url_params 由调用方从 pull_proxy_urls.params 取得后传入（已反序列化为 dict），
               包含 schema、rtp_type 等地址级参数。
    返回 (vhost, app, stream, url, retry_count, timeout_sec, opt)
    """
    vhost  = proxy.get("vhost")  or "__defaultVhost__"
    app    = proxy.get("app",    "")
    stream = proxy.get("stream", "")

    custom_params_dict = {}
    raw_custom = proxy.get("custom_params") or "{}"
    try:
        custom_params_dict = json.loads(raw_custom) if isinstance(raw_custom, str) else raw_custom
        if not isinstance(custom_params_dict, dict):
            custom_params_dict = {}
    except Exception as e:
        mk_logger.log_warn(f"[build_proxy_call_args] 解析 custom_params 失败 id={proxy.get('id')}: {e}")

    retry_count = int(custom_params_dict.pop("retry_count",  -1))
    timeout_sec = float(custom_params_dict.pop("timeout_sec", 0.0))

    opt = {}
    raw_proto = proxy.get("protocol_params") or "{}"
    try:
        proto_dict = json.loads(raw_proto) if isinstance(raw_proto, str) else raw_proto
        if isinstance(proto_dict, dict):
            opt.update(proto_dict)
    except Exception as e:
        mk_logger.log_warn(f"[build_proxy_call_args] 解析 protocol_params 失败 id={proxy.get('id')}: {e}")
    opt.update(custom_params_dict)
    # 地址级参数（schema、rtp_type 等）优先级最高，覆盖其他同名参数
    if url_params:
        opt.update({k: v for k, v in url_params.items() if v != '' and v is not None})

    return vhost, app, stream, url, retry_count, timeout_sec, opt


def on_stream_not_found(args: dict, sender: dict, invoker) -> bool:
    mk_logger.log_info(f"on_stream_not_found, args: {args}, sender: {sender}")

    vhost  = args.get("vhost")  or "__defaultVhost__"
    app    = args.get("app",    "")
    stream = args.get("stream", "")

    # 查询数据库，看是否有匹配的按需拉流代理
    try:
        db.cursor.execute(
            "SELECT * FROM pull_proxies WHERE vhost=? AND app=? AND stream=? AND on_demand=1",
            (vhost, app, stream)
        )
        row = db.cursor.fetchone()
        proxy = dict(row) if row else None
    except Exception as e:
        mk_logger.log_warn(f"[on_stream_not_found] 查询数据库失败: {e}")
        proxy = None

    if proxy:
        # 找到按需拉流代理，启动拉流，让播放器等待流上线
        pid = proxy.get("id")
        # 从多地址表取第一条地址
        proxy_urls = db.get_proxy_urls(pid)
        first_url  = proxy_urls[0] if proxy_urls else {}
        url        = first_url.get("url", "")
        url_params = first_url.get("params", {})  # 已反序列化为 dict
        if not url:
            mk_logger.log_warn(f"[on_stream_not_found] 按需代理无有效地址 id={pid}")
            return False
        vhost, app, stream, url, retry_count, timeout_sec, opt = _build_proxy_call_args(proxy, url, url_params)
        mk_logger.log_info(
            f"[on_stream_not_found] 触发按需拉流 id={pid} {vhost}/{app}/{stream} url={url}"
        )

        def cb(err, key):
            if err:
                mk_logger.log_warn(f"[on_stream_not_found] 按需拉流失败 id={pid} {vhost}/{app}/{stream}: {err}")
            else:
                mk_logger.log_info(f"[on_stream_not_found] 按需拉流成功 id={pid} {vhost}/{app}/{stream}")

        opt['auto_close'] = True  # 按需拉流自动关闭，流无人观看且拉流成功后自动关闭
        mk_loader.add_stream_proxy(
            vhost, app, stream, url, cb,
            retry_count=len(proxy_urls) - 1,  # 首次拉取第一条地址，失败后自动重试剩余地址
            force=True,          # 已存在则不重复拉
            timeout_sec=timeout_sec,
            opt=opt,
        )
        # 此事件被python拦截，ZLM等待拉流成功后自动推送流给播放器
        return True

    # 按需拉流代理不存在，不处理事件
    return False


def on_http_access(parser: mk_loader.Parser, path: str, file_path: str, is_dir: bool, invoker, sender: dict) -> bool:
    # 获取frontend目录的绝对路径
    current_dir = os.path.dirname(os.path.abspath(__file__))
    frontend_path = os.path.abspath(os.path.join(current_dir, '..', 'frontend'))
    # 检查请求路径是否在frontend目录下
    if not file_path.startswith(frontend_path):
        mk_logger.log_warn(f"Access denied: path '{file_path}' is outside frontend directory")
        mk_loader.http_access_invoker_do(invoker, "Access denied by pymkui", path, 60 * 60)
        return True
    
    # 允许访问
    mk_loader.http_access_invoker_do(invoker, "", path, 60 * 60)
    return True

def on_player_proxy_failed(url: str, media_tuple: mk_loader.MediaTuple, ex: mk_loader.SockException) -> bool:
    mk_logger.log_info(f"on_player_proxy_failed: {url}, {media_tuple.shortUrl()}, {ex.what()}")

    # 尝试多地址切换：根据当前失败的 url 查找对应代理，切换到下一个备用地址
    try:
        vhost  = media_tuple.vhost  if hasattr(media_tuple, 'vhost')  else '__defaultVhost__'
        app    = media_tuple.app    if hasattr(media_tuple, 'app')    else ''
        stream = media_tuple.stream if hasattr(media_tuple, 'stream') else ''

        if not app or not stream:
            return False

        # 查询数据库
        db.cursor.execute(
            "SELECT * FROM pull_proxies WHERE vhost=? AND app=? AND stream=?",
            (vhost, app, stream)
        )
        row = db.cursor.fetchone()
        if not row:
            return False
        proxy = dict(row)
        pid = proxy.get("id")
        if not pid:
            return False

        proxy_urls = db.get_proxy_urls(int(pid))
        if len(proxy_urls) <= 1:
            # 只有一个地址，无法切换
            return False

        # 找到当前失败的地址索引
        current_idx = None
        for i, pu in enumerate(proxy_urls):
            if pu.get("url", "") == url:
                current_idx = i
                break

        if current_idx is None:
            current_idx = 0

        # 切换到下一个地址（循环）
        next_idx = (current_idx + 1) % len(proxy_urls)
        if next_idx == current_idx:
            return False  # 只有一条有效地址

        next_url_item = proxy_urls[next_idx]
        next_url      = next_url_item.get("url", "")
        next_params   = next_url_item.get("params", {})

        if not next_url:
            return False

        mk_logger.log_info(
            f"[on_player_proxy_failed] 切换备用地址 id={pid} {vhost}/{app}/{stream} "
            f"[{current_idx}→{next_idx}] {url} → {next_url}"
        )

        mk_loader.update_stream_proxy(vhost, app, stream, next_url, next_params)
        # 返回 True：Python 已接管处理，ZLM 不再默认处理
        return True
    except Exception as e:
        mk_logger.log_warn(f"[on_player_proxy_failed] 多地址切换异常: {e}")

    return False

# def on_exit():
#     mk_logger.log_info("on_exit")

# def on_publish(type: str, args: dict, invoker, sender: dict) -> bool:
#     mk_logger.log_info(f"type: {type}, args: {args}, sender: {sender}")
#     # opt 控制转协议，请参考配置文件[protocol]下字段
#     opt = {
#         #"enable_rtmp": "1"
#     }
#     # 响应推流鉴权结果
#     mk_loader.publish_auth_invoker_do(invoker, "", opt)
#     # 返回True代表此事件被python拦截
#     return True

# def on_play(args: dict, invoker, sender: dict) -> bool:
#     mk_logger.log_info(f"args: {args}, sender: {sender}")
#     # 响应播放鉴权结果
#     mk_loader.play_auth_invoker_do(invoker, "")
#     # 返回True代表此事件被python拦截
#     return True

# def on_flow_report(args: dict, totalBytes: int, totalDuration: int, isPlayer: bool, sender: dict) -> bool:
#     mk_logger.log_info(f"args: {args}, totalBytes: {totalBytes}, totalDuration: {totalDuration}, isPlayer: {isPlayer}, sender: {sender}")
#     # 返回True代表此事件被python拦截
#     return False

# def on_media_changed(is_register: bool, sender: mk_loader.MediaSource) -> bool:
#     mk_logger.log_info(f"is_register: {is_register}, sender: {sender.getUrl()}")
#     # 该事件在c++中也处理下
#     return False


# def on_record_mp4(info: dict) -> bool:
#     mk_logger.log_info(f"on_record_mp4, info: {info}")
#     # 返回True代表此事件被python拦截
#     return True
# def on_record_ts(info: dict) -> bool:
#     mk_logger.log_info(f"on_record_ts, info: {info}")
#     # 返回True代表此事件被python拦截
#     return True

# def on_stream_none_reader(sender: mk_loader.MediaSource) -> bool:
#     mk_logger.log_info(f"on_stream_none_reader: {sender.getUrl()}")
#     # 无人观看自动关闭
#     # sender.close(False)
#     # 返回True代表此事件被python拦截
#     return True

# def on_send_rtp_stopped(sender: mk_loader.MultiMediaSourceMuxer, ssrc: str, ex: mk_loader.SockException) -> bool:
#     mk_logger.log_info(f"on_send_rtp_stopped, ssrc: {ssrc}, ex: {ex.what()}, url: {sender.getMediaTuple().getUrl()}")
#     # 返回True代表此事件被python拦截
#     return True

# def on_rtp_server_timeout(local_port: int, tuple: mk_loader.MediaTuple, tcp_mode: int, re_use_port: bool, ssrc: int) -> bool:
#     mk_logger.log_info(f"on_rtp_server_timeout, local_port: {local_port}, tuple: {tuple.shortUrl()}, tcp_mode: {tcp_mode}, re_use_port: {re_use_port}, ssrc: {ssrc}")
#     # 返回True代表此事件被python拦截
#     return False

# def on_reload_config():
#     mk_logger.log_info(f"on_reload_config")

# class PyMultiMediaSourceMuxer:
#     def __init__(self, sender: mk_loader.MultiMediaSourceMuxer):
#         mk_logger.log_info(f"PyMultiMediaSourceMuxer: {sender.getMediaTuple().shortUrl()}")
#     def destroy(self):
#         mk_logger.log_info(f"~PyMultiMediaSourceMuxer")

#     def addTrack(self, track: mk_loader.Track):
#         mk_logger.log_info(f"addTrack: {track.getCodecName()}")
#         return True
#     def addTrackCompleted(self):
#         mk_logger.log_info(f"addTrackCompleted")
#     def inputFrame(self, frame: mk_loader.Frame):
#         # mk_logger.log_info(f"inputFrame: {frame.getCodecName()} {frame.dts()}")
#         return True
# def on_create_muxer(sender: mk_loader.MultiMediaSourceMuxer):
#     return PyMultiMediaSourceMuxer(sender)


# def on_get_rtsp_realm(args: dict, invoker, sender: dict) -> bool:
#     mk_logger.log_info(f"on_get_rtsp_realm, args: {args}, sender: {sender}")
#     mk_loader.rtsp_get_realm_invoker_do(invoker, "zlmediakit")
#     # 返回True代表此事件被python拦截
#     return True

# def on_rtsp_auth(args: dict, realm: str, user_name: str, must_no_encrypt: bool, invoker, sender:dict) -> bool:
#     mk_logger.log_info(f"on_rtsp_auth, args: {args}, realm: {realm}, user_name: {user_name}, must_no_encrypt: {must_no_encrypt}, sender: {sender}")
#     mk_loader.rtsp_auth_invoker_do(invoker, False, "zlmediakit")
#     # 返回True代表此事件被python拦截
#     return True