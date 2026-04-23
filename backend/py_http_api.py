import os
import sys
import json
import time
import psutil
import traceback
import httpx
import mk_loader
import mk_logger
import urllib.parse
from datetime import datetime
from typing import Optional
from fastapi import Request
from fastapi import FastAPI, Request, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from database import Database


# ---------- 添加：全局 JSON 美化 ----------
class PrettyJSONResponse(JSONResponse):
    def render(self, content) -> bytes:
        return json.dumps(
            content,
            ensure_ascii=False,
            indent=4
        ).encode("utf-8")
# ------------------------------------------------------------------

t = """
| 端口  | 协议    | 服务                            |
| ----- | ------- | ------------------------------- |
| 10800 | TCP     | StreamUI frontend                    |
| 10801 | TCP     | StreamUI backend               |
| 1935  | TCP     | RTMP 推流拉流                   |
| 8080  | TCP     | FLV、HLS、TS、fMP4、WebRTC 支持 |
| 8443  | TCP     | HTTPS、WebSocket 支持           |
| 8554  | TCP     | RTSP 服务端口                   |
| 10000 | TCP/UDP | RTP、RTCP 端口                  |
| 8000  | UDP     | WebRTC ICE/STUN 端口            |
| 9000  | UDP     | WebRTC 辅助端口                 |
"""

app = FastAPI(
    title="接口",
    version="latest",
    description=t,
    default_response_class=PrettyJSONResponse   # ★ 添加此行
)

@app.exception_handler(Exception)
async def all_exception_handler(request: Request, exc: Exception):
    stack = traceback.format_exc()
    mk_logger.log_warn(f"FastAPI crashed: {exc}\n{stack}")
    return {"code": 500, "msg": "server internal error"}

# 设置 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 全局变量（必须定义在模块顶部，不能放在函数里）
_last_net_bytes = None
_last_net_time = None

@app.get(
    "/index/pyapi/host-stats",
    tags=["性能"],
    summary="获取当前系统资源使用率",
)
async def get_host_stats():
    timestamp = datetime.now().strftime("%H:%M:%S")

    # CPU 使用率
    cpu_percent = psutil.cpu_percent(interval=None)

    # 内存
    memory = psutil.virtual_memory()
    memory_info = {
        "used": round(memory.used / (1024**3), 2),
        "total": round(memory.total / (1024**3), 2),
    }

    record_path = mk_loader.get_full_path(mk_loader.get_config("protocol.mp4_save_path"))
    # 磁盘
    disk = psutil.disk_usage(record_path)
    disk_info = {
        "used": round(disk.used / (1024**3), 2),
        "total": round(disk.total / (1024**3), 2),
    }

    # 网络速度（KB/s）
    net = psutil.net_io_counters()
    now = time.time()

    global _last_net_bytes, _last_net_time

    if _last_net_bytes is None:
        net_info = {"sent": 0.0, "recv": 0.0, "sent_total": net.bytes_sent / 1024, "recv_total": net.bytes_recv / 1024}
    else:
        dt = now - (_last_net_time or now)
        sent_speed = (net.bytes_sent - _last_net_bytes[0]) / 1024 / dt
        recv_speed = (net.bytes_recv - _last_net_bytes[1]) / 1024 / dt
        net_info = {
            "sent": round(sent_speed, 2),
            "recv": round(recv_speed, 2),
            "sent_total": net.bytes_sent / 1024,
            "recv_total": net.bytes_recv / 1024
        }

    # 记录本次值
    _last_net_bytes = (net.bytes_sent, net.bytes_recv)
    _last_net_time = now

    return {
        "code": 0,
        "data": {
            "time": timestamp,
            "cpu": round(cpu_percent, 2),
            "memory": memory_info,
            "disk": disk_info,
            "network": net_info
        },
    }


client = httpx.AsyncClient(
    timeout=30.0,
    limits=httpx.Limits(
        max_connections=100,
        max_keepalive_connections=50,
    ),
)

async def get_param_from_request(
    request: Request,
    name: str,
) -> Optional[str]:
    """
    从 Request 中依次从：
      1. query 参数
      2. body（json / form）
      3. header
    获取参数，返回 str 或 None
    """

    # ---------- 1️⃣ Query ----------
    value = request.query_params.get(name)
    if value is not None:
        return value

    # ---------- 2️⃣ Body ----------
    try:
        body_bytes = await request.body()
        if body_bytes:
            content_type = request.headers.get("content-type", "")

            # ---- JSON ----
            if "application/json" in content_type:
                data = json.loads(body_bytes.decode("utf-8"))
                if isinstance(data, dict) and name in data:
                    v = data.get(name)
                    return None if v is None else str(v)

            # ---- form / multipart ----
            elif (
                "application/x-www-form-urlencoded" in content_type
                or "multipart/form-data" in content_type
            ):
                parsed = urllib.parse.parse_qs(
                    body_bytes.decode("utf-8"),
                    keep_blank_values=True,
                )
                if name in parsed and parsed[name]:
                    return parsed[name][0]
    except Exception:
        # body 解析失败直接忽略，继续查 header
        pass

    # ---------- 3️⃣ Header ----------
    value = request.headers.get(name)
    if value is not None:
        return value

    return None


def get_zlm_base_url() -> str:
    """
    获取 ZLMediaKit 内部访问的 base URL。
    - http.port != 0  → http://127.0.0.1:{http.port}
    - http.port == 0  → https://127.0.0.1:{http.ssl_port}
    """
    http_port = mk_loader.get_config("http.port")
    try:
        http_port = int(http_port)
    except (TypeError, ValueError):
        http_port = 0

    if http_port != 0:
        return f"http://127.0.0.1:{http_port}"
    else:
        ssl_port = mk_loader.get_config("http.ssl_port")
        return f"https://127.0.0.1:{ssl_port}"


def get_forward_headers(request: Request) -> dict:
    """
    从入站请求中提取需要透传给 ZLMediaKit 的 headers（目前仅 cookie）。
    """
    headers: dict = {}
    # 直接从 headers 中获取 cookie 字段（大小写不敏感）
    cookie_header = None
    for key, value in request.headers.items():
        if key.lower() == "cookie":
            cookie_header = value
            break
    
    if cookie_header:
        headers["Cookie"] = cookie_header
    return headers


# 初始化数据库实例
db = Database()

@app.post(
    "/index/pyapi/add_protocol_options",
    tags=["转协议预设"],
    summary="添加转协议预设参数",
)
async def add_protocol_options(request: Request):
    """
    添加转协议预设参数
    
    参数：
    - name: 预设名称（必选）
    - modify_stamp: 转协议时，是否开启帧级时间戳覆盖（字符串类型）
    - enable_audio: 转协议是否开启音频（字符串类型）
    - add_mute_audio: 添加acc静音音频（字符串类型）
    - auto_close: 无人观看时，是否直接关闭（字符串类型）
    - continue_push_ms: 推流断开后超时时间（毫秒，字符串类型）
    - paced_sender_ms: 平滑发送定时器间隔（毫秒，字符串类型）
    - enable_hls: 是否开启转换为hls(mpegts)（字符串类型）
    - enable_hls_fmp4: 是否开启转换为hls(fmp4)（字符串类型）
    - enable_mp4: 是否开启MP4录制（字符串类型）
    - enable_rtsp: 是否开启转换为rtsp/webrtc（字符串类型）
    - enable_rtmp: 是否开启转换为rtmp/flv（字符串类型）
    - enable_ts: 是否开启转换为http-ts/ws-ts（字符串类型）
    - enable_fmp4: 是否开启转换为http-fmp4/ws-fmp4（字符串类型）
    - mp4_as_player: 是否将mp4录制当做观看者（字符串类型）
    - mp4_max_second: mp4切片大小（秒，字符串类型）
    - mp4_save_path: mp4录制保存路径（字符串类型）
    - hls_save_path: hls录制保存路径（字符串类型）
    - hls_demand: hls协议是否按需生成（字符串类型）
    - rtsp_demand: rtsp[s]协议是否按需生成（字符串类型）
    - rtmp_demand: rtmp[s]、http[s]-flv、ws[s]-flv协议是否按需生成（字符串类型）
    - ts_demand: http[s]-ts协议是否按需生成（字符串类型）
    - fmp4_demand: http[s]-fmp4、ws[s]-fmp4协议是否按需生成（字符串类型）
    
    注意：所有参数都是字符串类型，默认为NULL，用户可以不指定，C++程序会加载配置文件默认配置
    """
    try:
        body_bytes = await request.body()
        if not body_bytes:
            return {"code": -1, "msg": "请求体为空"}
        
        content_type = request.headers.get("content-type", "")
        
        if "application/json" in content_type or not content_type:
            try:
                data = json.loads(body_bytes.decode("utf-8"))
            except:
                data = {}
        elif "application/x-www-form-urlencoded" in content_type or "multipart/form-data" in content_type:
            parsed = urllib.parse.parse_qs(body_bytes.decode("utf-8"), keep_blank_values=True)
            data = {k: v[0] if len(v) == 1 else v for k, v in parsed.items()}
        else:
            try:
                data = json.loads(body_bytes.decode("utf-8"))
            except:
                return {"code": -1, "msg": f"不支持的Content-Type: {content_type}"}
        
        if not isinstance(data, dict):
            return {"code": -1, "msg": "参数格式错误"}
        
        name = data.get("name")
        if not name:
            return {"code": -1, "msg": "预设名称不能为空"}
        
        kwargs = {}
        for key in ['modify_stamp', 'enable_audio', 'add_mute_audio', 'auto_close',
                    'continue_push_ms', 'paced_sender_ms', 'enable_hls', 'enable_hls_fmp4',
                    'enable_mp4', 'enable_rtsp', 'enable_rtmp', 'enable_ts', 'enable_fmp4',
                    'mp4_as_player', 'mp4_max_second', 'mp4_save_path', 'hls_save_path',
                    'hls_demand', 'rtsp_demand', 'rtmp_demand', 'ts_demand', 'fmp4_demand']:
            if key in data:
                kwargs[key] = str(data[key])
        
        option_id = db.add_protocol_option(name, **kwargs)
        if option_id:
            return {"code": 0, "msg": "添加成功", "data": {"id": option_id}}
        else:
            return {"code": -1, "msg": "添加失败，预设名称可能已存在"}
    except Exception as e:
        mk_logger.log_warn(f"添加转协议预设失败: {e}")
        return {"code": -1, "msg": f"添加失败: {str(e)}"}

@app.post(
    "/index/pyapi/update_protocol_options",
    tags=["转协议预设"],
    summary="修改转协议预设参数",
)
async def update_protocol_options(request: Request):
    """
    修改转协议预设参数
    
    参数：
    - id: 预设ID（必选）
    - 其他参数同添加接口
    """
    try:
        body_bytes = await request.body()
        if not body_bytes:
            return {"code": -1, "msg": "请求体为空"}
        
        content_type = request.headers.get("content-type", "")
        
        if "application/json" in content_type or not content_type:
            try:
                data = json.loads(body_bytes.decode("utf-8"))
            except:
                data = {}
        elif "application/x-www-form-urlencoded" in content_type or "multipart/form-data" in content_type:
            parsed = urllib.parse.parse_qs(body_bytes.decode("utf-8"), keep_blank_values=True)
            data = {k: v[0] if len(v) == 1 else v for k, v in parsed.items()}
        else:
            try:
                data = json.loads(body_bytes.decode("utf-8"))
            except:
                return {"code": -1, "msg": f"不支持的Content-Type: {content_type}"}
        
        if not isinstance(data, dict):
            return {"code": -1, "msg": "参数格式错误"}
        
        option_id = data.get("id")
        if not option_id:
            return {"code": -1, "msg": "预设ID不能为空"}
        
        try:
            option_id = int(option_id)
        except (ValueError, TypeError):
            return {"code": -1, "msg": "预设ID格式错误"}
        
        kwargs = {}
        for key in ['name', 'modify_stamp', 'enable_audio', 'add_mute_audio', 'auto_close',
                    'continue_push_ms', 'paced_sender_ms', 'enable_hls', 'enable_hls_fmp4',
                    'enable_mp4', 'enable_rtsp', 'enable_rtmp', 'enable_ts', 'enable_fmp4',
                    'mp4_as_player', 'mp4_max_second', 'mp4_save_path', 'hls_save_path',
                    'hls_demand', 'rtsp_demand', 'rtmp_demand', 'ts_demand', 'fmp4_demand']:
            if key in data:
                kwargs[key] = str(data[key])
        
        if db.update_protocol_option(option_id, **kwargs):
            return {"code": 0, "msg": "修改成功"}
        else:
            return {"code": -1, "msg": "修改失败，预设不存在或名称已存在"}
    except Exception as e:
        mk_logger.log_warn(f"修改转协议预设失败: {e}")
        return {"code": -1, "msg": f"修改失败: {str(e)}"}

@app.post(
    "/index/pyapi/delete_protocol_options",
    tags=["转协议预设"],
    summary="删除转协议预设参数",
)
async def delete_protocol_options(request: Request):
    """
    删除转协议预设参数
    
    参数：
    - id: 预设ID（必选）
    """
    try:
        body_bytes = await request.body()
        if not body_bytes:
            return {"code": -1, "msg": "请求体为空"}
        
        content_type = request.headers.get("content-type", "")
        
        if "application/json" in content_type or not content_type:
            try:
                data = json.loads(body_bytes.decode("utf-8"))
            except:
                data = {}
        elif "application/x-www-form-urlencoded" in content_type or "multipart/form-data" in content_type:
            parsed = urllib.parse.parse_qs(body_bytes.decode("utf-8"), keep_blank_values=True)
            data = {k: v[0] if len(v) == 1 else v for k, v in parsed.items()}
        else:
            try:
                data = json.loads(body_bytes.decode("utf-8"))
            except:
                return {"code": -1, "msg": f"不支持的Content-Type: {content_type}"}
        
        if not isinstance(data, dict):
            return {"code": -1, "msg": "参数格式错误"}
        
        option_id = data.get("id")
        if not option_id:
            return {"code": -1, "msg": "预设ID不能为空"}
        
        try:
            option_id = int(option_id)
        except (ValueError, TypeError):
            return {"code": -1, "msg": "预设ID格式错误"}
        
        if db.delete_protocol_option(option_id):
            return {"code": 0, "msg": "删除成功"}
        else:
            return {"code": -1, "msg": "删除失败，预设不存在"}
    except Exception as e:
        mk_logger.log_warn(f"删除转协议预设失败: {e}")
        return {"code": -1, "msg": f"删除失败: {str(e)}"}

@app.get(
    "/index/pyapi/get_protocol_options_list",
    tags=["转协议预设"],
    summary="获取转协议预设参数列表",
)
async def get_protocol_options_list():
    """
    获取转协议预设参数列表
    """
    try:
        options = db.get_all_protocol_options()
        return {"code": 0, "msg": "获取成功", "data": options}
    except Exception as e:
        mk_logger.log_warn(f"获取转协议预设列表失败: {e}")
        return {"code": -1, "msg": f"获取失败: {str(e)}"}

@app.get(
    "/index/pyapi/get_protocol_options",
    tags=["转协议预设"],
    summary="获取转协议预设参数详情",
)
async def get_protocol_options(id: int = Query(..., description="预设ID")):
    """
    获取转协议预设参数详情
    
    参数：
    - id: 预设ID（必选）
    """
    try:
        option = db.get_protocol_option(id)
        if option:
            return {"code": 0, "msg": "获取成功", "data": option}
        else:
            return {"code": -1, "msg": "预设不存在"}
    except Exception as e:
        mk_logger.log_warn(f"获取转协议预设详情失败: {e}")
        return {"code": -1, "msg": f"获取失败: {str(e)}"}

@app.post(
    "/index/pyapi/addStreamProxy",
    tags=["拉流代理"],
    summary="添加拉流代理",
)
async def add_stream_proxy(request: Request):
    """
    添加拉流代理

    参数：
    - vhost: 虚拟主机，默认__defaultVhost__
    - app: 应用名（必选）
    - stream: 流ID（必选）
    - url: 拉流地址（必选）
    - on_demand: 按需拉流（bool，0/1）。为 1 时不立即调用 ZLMediaKit addStreamProxy，
                 仅将配置写入数据库，等待有人播放时再由 ZLM 自动触发拉流。
    - custom_params: 自定义参数（JSON字符串）
    - protocol_params: 转协议参数（JSON字符串）
    """
    try:
        body_bytes = await request.body()
        if not body_bytes:
            return {"code": -1, "msg": "请求体为空"}
        
        content_type = request.headers.get("content-type", "")
        
        if "application/json" in content_type or not content_type:
            try:
                data = json.loads(body_bytes.decode("utf-8"))
            except:
                data = {}
        elif "application/x-www-form-urlencoded" in content_type or "multipart/form-data" in content_type:
            parsed = urllib.parse.parse_qs(body_bytes.decode("utf-8"), keep_blank_values=True)
            data = {k: v[0] if len(v) == 1 else v for k, v in parsed.items()}
        else:
            try:
                data = json.loads(body_bytes.decode("utf-8"))
            except:
                return {"code": -1, "msg": f"不支持的Content-Type: {content_type}"}
        
        if not isinstance(data, dict):
            return {"code": -1, "msg": "参数格式错误"}
        
        vhost = data.get("vhost", "__defaultVhost__")
        app = data.get("app")
        stream = data.get("stream")

        # 多地址：urls=[{"url":..., "params": {"schema":"hls","rtp_type":"0",...}}, ...]
        urls_raw = data.get("urls")
        if isinstance(urls_raw, str):
            try:
                urls_raw = json.loads(urls_raw)
            except Exception:
                urls_raw = None
        urls_list = [u for u in (urls_raw or []) if isinstance(u, dict) and u.get("url")]

        if not app or not stream or not urls_list:
            return {"code": -1, "msg": "app、stream、urls 参数不能为空"}

        # 取第一条作为主地址及其地址级参数（schema、rtp_type 等）
        first_item        = urls_list[0]
        url               = first_item.get("url")
        first_url_params  = first_item.get("params", {})
        if not isinstance(first_url_params, dict):
            try:
                first_url_params = json.loads(first_url_params)
            except Exception:
                first_url_params = {}

        custom_params   = data.get("custom_params", "{}")
        protocol_params = data.get("protocol_params", "{}")
        remark          = data.get("remark", "")

        # on_demand: 接受 bool / 0 / 1 / "0" / "1" / "true" / "false"
        raw_on_demand = data.get("on_demand", 0)
        if isinstance(raw_on_demand, str):
            on_demand = raw_on_demand.lower() in ("1", "true", "yes")
        else:
            on_demand = bool(raw_on_demand)

        # force: 强制添加模式，1=拉流失败也写库；同时透传给 ZLM 的 force 参数
        raw_force = data.get("force", 0)
        if isinstance(raw_force, str):
            force = 1 if raw_force in ("1", "true", "yes") else 0
        else:
            force = 1 if raw_force else 0

        if on_demand:
            # 按需模式：直接写库，不调用 ZLM，等待播放时 ZLM 自动拉流
            proxy_id = db.add_pull_proxy({
                "vhost": vhost,
                "app": app,
                "stream": stream,
                "remark": remark,
                "custom_params": custom_params,
                "protocol_params": protocol_params,
                "on_demand": 1,
            })
            if proxy_id:
                db.set_proxy_urls(proxy_id, urls_list)
                return {"code": 0, "msg": "添加成功（按需模式，未立即拉流）", "data": {"id": proxy_id}}
            else:
                return {"code": -1, "msg": "写入数据库失败，vhost/app/stream 组合可能已存在"}

        # 普通/强制模式：调用 ZLMediaKit 的 addStreamProxy 接口
        # schema、rtp_type 等地址级参数从第一条地址的 params 取
        zlm_url = f"{get_zlm_base_url()}/index/api/addStreamProxy"
        zlm_params = {
            "vhost": vhost,
            "app": app,
            "stream": stream,
            "url": url,
            "force": force,
        }
        # 将第一条地址的 params 透传给 ZLM（schema、rtp_type 等）
        zlm_params.update({k: v for k, v in first_url_params.items() if v != '' and v is not None})

        # 添加自定义参数（不含 schema/rtp_type，已在地址级 params 中）
        if custom_params:
            try:
                custom_params_dict = json.loads(custom_params) if isinstance(custom_params, str) else custom_params
                if isinstance(custom_params_dict, dict):
                    zlm_params.update(custom_params_dict)
            except Exception:
                pass

        # 添加转协议参数
        if protocol_params:
            try:
                protocol_params_dict = json.loads(protocol_params) if isinstance(protocol_params, str) else protocol_params
                if isinstance(protocol_params_dict, dict):
                    zlm_params.update(protocol_params_dict)
            except Exception:
                pass

        # 透传客户端 cookie
        response = await client.post(zlm_url, data=zlm_params, headers=get_forward_headers(request))
        result = response.json()

        if result.get("code") == 0:
            pid = db.add_pull_proxy({
                "vhost": vhost,
                "app": app,
                "stream": stream,
                "remark": remark,
                "custom_params": custom_params,
                "protocol_params": protocol_params,
                "on_demand": 0,
            })
            if pid:
                db.set_proxy_urls(pid, urls_list)
            return {"code": 0, "msg": "添加成功", "data": result.get("data")}
        elif force:
            pid = db.add_pull_proxy({
                "vhost": vhost,
                "app": app,
                "stream": stream,
                "remark": remark,
                "custom_params": custom_params,
                "protocol_params": protocol_params,
                "on_demand": 0,
            })
            if pid:
                db.set_proxy_urls(pid, urls_list)
            zlm_msg = result.get("msg", "ZLM返回失败")
            return {"code": 0, "msg": f"强制添加成功（ZLM: {zlm_msg}）", "data": result.get("data")}
        else:
            return {"code": -1, "msg": result.get("msg", "添加失败")}
    except Exception as e:
        mk_logger.log_warn(f"添加拉流代理失败: {e}")
        return {"code": -1, "msg": f"添加失败: {str(e)}"}

@app.post(
    "/index/pyapi/delStreamProxy",
    tags=["拉流代理"],
    summary="删除拉流代理",
)
async def del_stream_proxy(request: Request):
    """
    删除拉流代理

    参数：
    - id: 数据库记录的唯一 ID（必选）

    流程：
    1. 按 id 查询数据库，获取 vhost/app/stream
    2. 组合 key = vhost/app/stream，调用 ZLMediaKit delStreamProxy（ZLM 侧不存在不报错）
    3. 无论 ZLM 返回什么，都从数据库删除该记录
    """
    try:
        body_bytes = await request.body()
        if not body_bytes:
            return {"code": -1, "msg": "请求体为空"}

        content_type = request.headers.get("content-type", "")

        if "application/json" in content_type or not content_type:
            try:
                data = json.loads(body_bytes.decode("utf-8"))
            except:
                data = {}
        elif "application/x-www-form-urlencoded" in content_type or "multipart/form-data" in content_type:
            parsed = urllib.parse.parse_qs(body_bytes.decode("utf-8"), keep_blank_values=True)
            data = {k: v[0] if len(v) == 1 else v for k, v in parsed.items()}
        else:
            try:
                data = json.loads(body_bytes.decode("utf-8"))
            except:
                return {"code": -1, "msg": f"不支持的Content-Type: {content_type}"}

        if not isinstance(data, dict):
            return {"code": -1, "msg": "参数格式错误"}

        proxy_id = data.get("id")
        if not proxy_id:
            return {"code": -1, "msg": "id 参数不能为空"}
        try:
            proxy_id = int(proxy_id)
        except (ValueError, TypeError):
            return {"code": -1, "msg": "id 格式错误，必须为整数"}

        # 1. 查询数据库获取流信息
        proxy = db.get_pull_proxy(proxy_id)
        if not proxy:
            return {"code": -1, "msg": "代理不存在"}

        vhost  = proxy.get("vhost") or "__defaultVhost__"
        app    = proxy.get("app") or ""
        stream = proxy.get("stream") or ""
        if not app or not stream:
            return {"code": -1, "msg": "数据库记录异常：app/stream 为空"}
        key    = f"{vhost}/{app}/{stream}"

        # 2. 调用 ZLMediaKit delStreamProxy，ZLM 侧不存在时仅记录日志
        try:
            zlm_url = f"{get_zlm_base_url()}/index/api/delStreamProxy"
            response = await client.post(
                zlm_url,
                data={"key": key},
                headers=get_forward_headers(request),
            )
            zlm_result = response.json()
            if zlm_result.get("code") != 0:
                mk_logger.log_warn(
                    f"ZLM delStreamProxy 返回非 0: {zlm_result.get('msg')}，key={key}"
                )
        except Exception as e:
            mk_logger.log_warn(f"调用 ZLM delStreamProxy 失败（忽略）: {e}，key={key}")

        # 3. 无论 ZLM 结果如何，删除数据库记录
        db.delete_pull_proxy(vhost, app, stream)

        return {"code": 0, "msg": "删除成功"}
    except Exception as e:
        mk_logger.log_warn(f"删除拉流代理失败: {e}")
        return {"code": -1, "msg": f"删除失败: {str(e)}"}

@app.get(
    "/index/pyapi/getStreamProxyList",
    tags=["拉流代理"],
    summary="获取拉流代理列表",
)
async def get_stream_proxy_list():
    """获取拉流代理列表（含各代理的多地址列表）"""
    try:
        proxies = db.get_all_pull_proxies_with_urls()
        return {"code": 0, "msg": "获取成功", "data": proxies}
    except Exception as e:
        mk_logger.log_warn(f"获取拉流代理列表失败: {e}")
        return {"code": -1, "msg": f"获取失败: {str(e)}"}

@app.get(
    "/index/pyapi/getStreamProxy",
    tags=["拉流代理"],
    summary="获取拉流代理详情",
)
async def get_stream_proxy(id: int = Query(..., description="代理ID")):
    """获取拉流代理详情（含多地址列表）"""
    try:
        proxy = db.get_pull_proxy_with_urls(id)
        if proxy:
            return {"code": 0, "msg": "获取成功", "data": proxy}
        else:
            return {"code": -1, "msg": "代理不存在"}
    except Exception as e:
        mk_logger.log_warn(f"获取拉流代理详情失败: {e}")
        return {"code": -1, "msg": f"获取失败: {str(e)}"}

@app.post(
    "/index/pyapi/updateStreamProxy",
    tags=["拉流代理"],
    summary="更新拉流代理配置",
)
async def update_stream_proxy(request: Request):
    """
    更新拉流代理的配置（不重启 ZLM 拉流，仅更新数据库）。

    参数：
    - id: 数据库记录 ID（必选）
    - urls: 多地址列表（[{"url":..., "params":{...}}, ...]，可选）
    - remark: 备注（可选）
    - vhost: 虚拟主机（可选，不建议修改）
    - app: 应用名（可选，不建议修改）
    - stream: 流ID（可选，不建议修改）
    - on_demand: 按需模式（可选）
    - custom_params: 自定义参数 JSON（可选）
    - protocol_params: 转协议参数 JSON（可选）
    """
    try:
        body_bytes = await request.body()
        if not body_bytes:
            return {"code": -1, "msg": "请求体为空"}
        content_type = request.headers.get("content-type", "")
        if "application/json" in content_type or not content_type:
            try:
                data = json.loads(body_bytes.decode("utf-8"))
            except Exception:
                data = {}
        else:
            parsed = urllib.parse.parse_qs(body_bytes.decode("utf-8"), keep_blank_values=True)
            data = {k: v[0] if len(v) == 1 else v for k, v in parsed.items()}

        if not isinstance(data, dict):
            return {"code": -1, "msg": "参数格式错误"}

        proxy_id = data.get("id")
        if not proxy_id:
            return {"code": -1, "msg": "id 参数不能为空"}
        try:
            proxy_id = int(proxy_id if not isinstance(proxy_id, list) else proxy_id[0])
        except (ValueError, TypeError):
            return {"code": -1, "msg": "id 格式错误，必须为整数"}

        # 确认记录存在
        existing = db.get_pull_proxy(proxy_id)
        if not existing:
            return {"code": -1, "msg": "代理不存在"}

        # 构建更新字段（只更新传入的字段）
        update_kwargs = {}
        if "vhost" in data:
            update_kwargs["vhost"] = data["vhost"] or "__defaultVhost__"
        if "app" in data and data["app"]:
            update_kwargs["app"] = data["app"]
        if "stream" in data and data["stream"]:
            update_kwargs["stream"] = data["stream"]
        if "remark" in data:
            update_kwargs["remark"] = data.get("remark", "")
        if "custom_params" in data:
            update_kwargs["custom_params"] = data["custom_params"] if isinstance(data["custom_params"], str) else json.dumps(data["custom_params"], ensure_ascii=False)
        if "protocol_params" in data:
            update_kwargs["protocol_params"] = data["protocol_params"] if isinstance(data["protocol_params"], str) else json.dumps(data["protocol_params"], ensure_ascii=False)
        if "on_demand" in data:
            raw_od = data["on_demand"]
            if isinstance(raw_od, str):
                update_kwargs["on_demand"] = 1 if raw_od.lower() in ("1", "true", "yes") else 0
            else:
                update_kwargs["on_demand"] = 1 if raw_od else 0

        # 更新主表
        if update_kwargs:
            db.update_pull_proxy(proxy_id, **update_kwargs)

        # 更新多地址列表（全量替换）
        urls_raw = data.get("urls")
        if urls_raw is not None:
            if isinstance(urls_raw, str):
                try:
                    urls_raw = json.loads(urls_raw)
                except Exception:
                    urls_raw = []
            urls_list = [u for u in (urls_raw or []) if isinstance(u, dict) and u.get("url")]
            db.set_proxy_urls(proxy_id, urls_list)

        return {"code": 0, "msg": "修改成功"}
    except Exception as e:
        mk_logger.log_warn(f"更新拉流代理失败: {e}")
        return {"code": -1, "msg": f"修改失败: {str(e)}"}


@app.post(
    "/index/pyapi/toggleStreamProxyMode",
    tags=["拉流代理"],
    summary="切换拉流代理模式（按需↔立即）",
)
async def toggle_stream_proxy_mode(request: Request):
    """
    切换拉流代理的 on_demand 模式。

    - 按需(on_demand=1) → 立即(on_demand=0)：
      调用 ZLM addStreamProxy（force=1 覆盖已有），写库 on_demand=0
    - 立即(on_demand=0) → 按需(on_demand=1)：
      调用 ZLM delStreamProxy 停止当前拉流，写库 on_demand=1

    参数：
    - id: 数据库记录 ID（必选）
    """
    try:
        body_bytes = await request.body()
        if not body_bytes:
            return {"code": -1, "msg": "请求体为空"}
        content_type = request.headers.get("content-type", "")
        if "application/json" in content_type or not content_type:
            try:
                data = json.loads(body_bytes.decode("utf-8"))
            except Exception:
                data = {}
        else:
            parsed = urllib.parse.parse_qs(body_bytes.decode("utf-8"), keep_blank_values=True)
            data = {k: v[0] if len(v) == 1 else v for k, v in parsed.items()}

        if not isinstance(data, dict):
            return {"code": -1, "msg": "参数格式错误"}

        proxy_id = data.get("id")
        if not proxy_id:
            return {"code": -1, "msg": "id 参数不能为空"}
        try:
            proxy_id = int(proxy_id)
        except (ValueError, TypeError):
            return {"code": -1, "msg": "id 格式错误，必须为整数"}

        proxy = db.get_pull_proxy(proxy_id)
        if not proxy:
            return {"code": -1, "msg": "代理不存在"}

        vhost  = proxy.get("vhost") or "__defaultVhost__"
        app    = proxy.get("app") or ""
        stream = proxy.get("stream") or ""
        key    = f"{vhost}/{app}/{stream}"
        current_on_demand = int(bool(proxy.get("on_demand", 0)))

        # 从多地址表取第一条地址
        proxy_urls = db.get_proxy_urls(proxy_id)
        first_url_item  = proxy_urls[0] if proxy_urls else {}
        url             = first_url_item.get("url") or ""
        url_params      = first_url_item.get("params") or {}  # 已由 get_proxy_urls 反序列化为 dict

        if current_on_demand == 1:
            # 按需 → 立即：调用 ZLM addStreamProxy（force=1）
            zlm_url = f"{get_zlm_base_url()}/index/api/addStreamProxy"
            zlm_params = {"vhost": vhost, "app": app, "stream": stream, "url": url, "force": 1}
            # 将地址级参数（schema、rtp_type 等）透传给 ZLM
            zlm_params.update({k: v for k, v in url_params.items() if v != '' and v is not None})
            # 追加保存的自定义/协议参数
            try:
                cp = json.loads(proxy.get("custom_params") or "{}")
                if isinstance(cp, dict):
                    zlm_params.update(cp)
            except Exception:
                pass
            try:
                pp = json.loads(proxy.get("protocol_params") or "{}")
                if isinstance(pp, dict):
                    zlm_params.update(pp)
            except Exception:
                pass
            try:
                response = await client.post(zlm_url, data=zlm_params, headers=get_forward_headers(request))
            except (httpx.ConnectError, httpx.ConnectTimeout) as e:
                zlm_base = get_zlm_base_url()
                mk_logger.log_warn(f"toggle_stream_proxy_mode | 无法连接 ZLMediaKit ({zlm_base}): {e}")
                return {"code": -1, "msg": f"无法连接 ZLMediaKit（{zlm_base}），请确认 ZLM 已启动并端口可访问"}
            except httpx.TimeoutException as e:
                mk_logger.log_warn(f"toggle_stream_proxy_mode | 连接 ZLMediaKit 超时: {e}")
                return {"code": -1, "msg": "连接 ZLMediaKit 超时，请检查网络或 ZLM 负载"}
            result = response.json()
            if result.get("code") != 0:
                return {"code": -1, "msg": f"ZLM 添加失败: {result.get('msg', '未知错误')}"}
            db.update_pull_proxy(proxy_id, on_demand=0)
            return {"code": 0, "msg": "已切换为立即模式", "data": {"on_demand": 0}}
        else:
            # 立即 → 按需：调用 ZLM delStreamProxy 停止拉流
            zlm_url = f"{get_zlm_base_url()}/index/api/delStreamProxy"
            try:
                response = await client.post(
                    zlm_url,
                    data={"key": key},
                    headers=get_forward_headers(request),
                )
                zlm_result = response.json()
                if zlm_result.get("code") != 0:
                    mk_logger.log_warn(
                        f"ZLM delStreamProxy 返回非 0: {zlm_result.get('msg')}，key={key}"
                    )
            except (httpx.ConnectError, httpx.ConnectTimeout, httpx.TimeoutException) as e:
                mk_logger.log_warn(f"调用 ZLM delStreamProxy 连接失败（忽略，继续写库）: {e}，key={key}")
            except Exception as e:
                mk_logger.log_warn(f"调用 ZLM delStreamProxy 失败（忽略）: {e}，key={key}")
            db.update_pull_proxy(proxy_id, on_demand=1)
            return {"code": 0, "msg": "已切换为按需模式", "data": {"on_demand": 1}}

    except Exception as e:
        mk_logger.log_warn(f"toggle_stream_proxy_mode | 切换拉流代理模式失败: {e}")
        return {"code": -1, "msg": f"切换失败: {str(e)}"}


# ══════════════════════════════════════════════════════════════════════
# 插件管理接口
# ══════════════════════════════════════════════════════════════════════
import py_plugin as _py_plugin


@app.get(
    "/index/pyapi/plugin/list",
    tags=["插件管理"],
    summary="获取已加载的插件列表",
)
async def plugin_list():
    """返回当前内存中所有已加载插件的基本信息"""
    try:
        plugins = _py_plugin.registry.get_all()
        return {"code": 0, "data": plugins}
    except Exception as e:
        mk_logger.log_warn(f"plugin_list error: {e}")
        return {"code": -1, "msg": str(e)}


@app.post(
    "/index/pyapi/plugin/reload",
    tags=["插件管理"],
    summary="热加载插件目录",
)
async def plugin_reload():
    """
    重新扫描 plugins/ 目录，热加载所有插件模块。
    加载完成后自动将数据库中已有绑定重新同步到注册中心。
    """
    try:
        loaded = _py_plugin.registry.load()
        # 重载完毕后，把数据库绑定重新同步到 registry
        _sync_bindings_from_db()
        return {
            "code": 0,
            "msg": f"热加载完成，共加载 {len(loaded)} 个插件",
            "data": list(loaded.keys()),
        }
    except Exception as e:
        mk_logger.log_warn(f"plugin_reload error: {e}")
        return {"code": -1, "msg": str(e)}


@app.get(
    "/index/pyapi/plugin/events",
    tags=["插件管理"],
    summary="获取所有支持的事件类型",
)
async def plugin_events():
    """返回系统支持绑定插件的所有 ZLM 事件类型"""
    return {"code": 0, "data": _py_plugin.SUPPORTED_EVENTS}


@app.get(
    "/index/pyapi/plugin/bindings",
    tags=["插件管理"],
    summary="获取所有事件绑定配置",
)
async def plugin_get_bindings():
    """
    返回所有支持事件的绑定配置。
    格式：[{event_type, bindings:[{id, plugin_name, params, priority, enabled}], updated_at}, ...]
    """
    try:
        db_rows = db.get_all_plugin_bindings()
        # 构造 event_type → bindings 映射
        db_map = {r["event_type"]: r for r in db_rows}
        result = []
        for evt in _py_plugin.SUPPORTED_EVENTS:
            rec = db_map.get(evt)
            if rec:
                result.append(rec)
            else:
                result.append({
                    "event_type": evt,
                    "bindings": [],
                })
        return {"code": 0, "data": result}
    except Exception as e:
        mk_logger.log_warn(f"plugin_get_bindings error: {e}")
        return {"code": -1, "msg": str(e)}


@app.post(
    "/index/pyapi/plugin/bindings/save",
    tags=["插件管理"],
    summary="保存事件绑定配置（全量替换）",
)
async def plugin_save_binding(request: Request):
    """
    全量保存某个事件类型的插件绑定配置，并立即生效到内存。

    请求体（JSON）：
    - event_type: str  — 事件类型，必须是 SUPPORTED_EVENTS 之一
    - bindings: list   — 绑定列表（有序），每项格式：
        {"plugin_name": str, "params": dict, "enabled": 0/1}
    - enabled: int (0/1) — 整组启用状态，默认 1
    """
    try:
        body = await request.body()
        data = json.loads(body.decode("utf-8"))

        event_type = data.get("event_type", "").strip()
        bindings   = data.get("bindings", [])
        enabled    = int(data.get("enabled", 1))

        if event_type not in _py_plugin.SUPPORTED_EVENTS:
            return {"code": -1, "msg": f"不支持的事件类型: {event_type}"}
        if not isinstance(bindings, list):
            return {"code": -1, "msg": "bindings 必须是数组"}

        # 写库（全量替换）
        ok = db.save_plugin_bindings_for_event(event_type, bindings, enabled)
        if not ok:
            return {"code": -1, "msg": "数据库写入失败"}

        # 立即同步到内存 registry
        if enabled:
            registry_bindings = [
                {"name": b.get("plugin_name") or b.get("name", ""),
                 "params": b.get("params") or {}}
                for b in bindings
            ]
            _py_plugin.registry.set_bindings(event_type, registry_bindings)
        else:
            _py_plugin.registry.set_bindings(event_type, [])

        return {"code": 0, "msg": "保存成功"}
    except Exception as e:
        mk_logger.log_warn(f"plugin_save_binding error: {e}")
        return {"code": -1, "msg": str(e)}


@app.post(
    "/index/pyapi/plugin/bindings/update_params",
    tags=["插件管理"],
    summary="更新单个绑定的参数",
)
async def plugin_update_binding_params(request: Request):
    """
    更新某个事件-插件绑定的自定义参数，不影响其他绑定。

    请求体（JSON）：
    - event_type: str
    - plugin_name: str
    - params: dict       — 自定义参数键值对
    - enabled: int (0/1) — 可选，默认不改变
    """
    try:
        body = await request.body()
        data = json.loads(body.decode("utf-8"))

        event_type  = data.get("event_type", "").strip()
        plugin_name = data.get("plugin_name", "").strip()
        params      = data.get("params", {})

        if not event_type or not plugin_name:
            return {"code": -1, "msg": "event_type 和 plugin_name 不能为空"}

        # 读出当前绑定，找到该项更新参数
        current = db.get_plugin_bindings_for_event(event_type)
        item = next((x for x in current if x["plugin_name"] == plugin_name), None)
        if item is None:
            return {"code": -1, "msg": f"绑定不存在: {event_type}/{plugin_name}"}

        enabled  = data.get("enabled", item["enabled"])
        priority = item["priority"]

        ok = db.upsert_plugin_binding_item(event_type, plugin_name, params, priority, enabled)
        if not ok:
            return {"code": -1, "msg": "数据库更新失败"}

        # 同步内存
        _sync_bindings_from_db_for_event(event_type)
        return {"code": 0, "msg": "参数更新成功"}
    except Exception as e:
        mk_logger.log_warn(f"plugin_update_binding_params error: {e}")
        return {"code": -1, "msg": str(e)}


@app.post(
    "/index/pyapi/plugin/bindings/delete",
    tags=["插件管理"],
    summary="删除事件绑定配置",
)
async def plugin_delete_binding(request: Request):
    """
    删除某个事件类型的全部绑定配置（或单条），并从内存中清除。

    请求体（JSON）：
    - event_type: str   — 必填
    - plugin_name: str  — 可选；若提供则只删该插件的绑定，否则删整个事件的绑定
    """
    try:
        body = await request.body()
        data = json.loads(body.decode("utf-8"))
        event_type  = data.get("event_type", "").strip()
        plugin_name = data.get("plugin_name", "").strip()
        if not event_type:
            return {"code": -1, "msg": "event_type 不能为空"}
        if plugin_name:
            db.delete_plugin_binding_item(event_type, plugin_name)
            _sync_bindings_from_db_for_event(event_type)
        else:
            db.delete_plugin_bindings_for_event(event_type)
            _py_plugin.registry.set_bindings(event_type, [])
        return {"code": 0, "msg": "删除成功"}
    except Exception as e:
        mk_logger.log_warn(f"plugin_delete_binding error: {e}")
        return {"code": -1, "msg": str(e)}


def _sync_bindings_from_db():
    """启动时 / 热加载后，把数据库中所有启用的绑定同步到内存 registry"""
    try:
        rows = db.get_all_plugin_bindings()
        for row in rows:
            event_type = row["event_type"]
            bindings = row.get("bindings", [])
            # 过滤出 enabled=1 的绑定项
            active = [
                {"name": b["plugin_name"], "params": b.get("params") or {}}
                for b in bindings if b.get("enabled", 1)
            ]
            _py_plugin.registry.set_bindings(event_type, active)
        mk_logger.log_info(f"[plugin] 同步绑定完成，共 {len(rows)} 条事件")
    except Exception as e:
        mk_logger.log_warn(f"[plugin] 同步绑定失败: {e}")


def _sync_bindings_from_db_for_event(event_type: str):
    """更新单个事件类型的内存绑定"""
    try:
        bindings = db.get_plugin_bindings_for_event(event_type)
        active = [
            {"name": b["plugin_name"], "params": b.get("params") or {}}
            for b in bindings if b.get("enabled", 1)
        ]
        _py_plugin.registry.set_bindings(event_type, active)
    except Exception as e:
        mk_logger.log_warn(f"[plugin] 同步单事件绑定失败 {event_type}: {e}")
