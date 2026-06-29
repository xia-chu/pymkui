# PyMKUI 项目开发规范与 AI 辅助指令

> 本文件作为 GitHub Copilot 及其他 AI 辅助工具的上下文指令文件，同时也是本项目的开发规范文档。  
> 最后更新：2026-03-18（补充 ZLM API 访问规范：get_zlm_base_url / get_forward_headers）

---

## 一、项目概述

**PyMKUI** 是 ZLMediaKit 的业务管理前端工程，采用前后端分离架构：

| 层次 | 目录 | 技术栈 | 说明 |
|------|------|--------|------|
| 前端 | `frontend/` | 原生 HTML + Tailwind CSS + 原生 JS | SPA 风格，iframe 子页面组织 |
| 后端 | `backend/` | Python 3.12 + FastAPI + SQLite | ZLMediaKit Python 插件模式运行 |
| 媒体服务 | 外部进程 | ZLMediaKit (C++) | 通过 HTTP API 交互 |
| 数据库 | `data/` | SQLite (`pymkui.db`) | 业务数据持久化 |

### 运行架构

```
浏览器
  └─ ZLMediaKit 内置 HTTP 服务 (port 8080)
        ├─ 静态文件服务 → frontend/ 目录
        ├─ /index/api/* → ZLMediaKit 原生 C++ HTTP API
        └─ /index/pyapi/* → Python FastAPI (通过 mk_plugin 注入到 ZLMediaKit)
                                └─ SQLite 数据库
```

### 端口规划

| 端口 | 协议 | 服务 |
|------|------|------|
| 8080 | TCP | ZLMediaKit HTTP / WS / HLS / FLV / FMP4 |
| 8443 | TCP | ZLMediaKit HTTPS / WSS |
| 1935 | TCP | RTMP 推拉流 |
| 8554 | TCP | RTSP |
| 10000 | TCP/UDP | RTP/RTCP (GB28181) |
| 8000 | UDP | WebRTC ICE/STUN |

---

## 二、目录结构规范

```
pymkui/
├── .github/
│   └── copilot-instructions.md   # 本文件（AI 指令 + 开发规范）
├── frontend/
│   ├── index.html                # 主框架页（导航 + iframe 容器）
│   ├── login.html                # 登录页
│   ├── js/
│   │   ├── api.js                # ★ 全局 API 封装对象（Api.*）
│   │   ├── dashboard.js          # 仪表板逻辑
│   │   ├── streams.js            # 流管理逻辑
│   │   ├── network.js            # 网络连接管理
│   │   ├── pull-proxy.js         # 拉流代理管理
│   │   ├── settings.js           # 服务器配置
│   │   ├── protocol-options.js   # 转协议预设管理
│   │   ├── whip.js               # WHIP 推流
│   │   ├── config_comments.js    # 配置项注释说明
│   │   └── lib/                  # 第三方库（jessibuca 等）
│   └── pages/                    # iframe 子页面
│       ├── dashboard.html
│       ├── streams.html
│       ├── network.html
│       ├── pull-proxy.html
│       ├── push-proxy.html
│       ├── settings.html
│       ├── protocol-options.html
│       ├── whip.html
│       └── auth.html
├── backend/
│   ├── config.py                 # 路径配置
│   ├── database.py               # SQLite 数据库操作类
│   ├── mk_logger.py              # 日志模块（适配 mk_loader/print 两种模式）
│   ├── mk_plugin.py              # ★ ZLMediaKit Python 插件入口
│   ├── py_http_api.py            # ★ FastAPI HTTP API 定义
│   ├── shared_loop.py            # 全局 asyncio 事件循环
│   └── requirements.txt
├── data/
│   └── pymkui.db                 # SQLite 数据库文件
└── README.md
```

---

## 三、后端开发规范（Python / FastAPI）

### 3.1 Python 版本与依赖

- **Python 版本**：3.12+
- **核心依赖**（`requirements.txt`）：
  ```
  psutil>=5.9.0
  httpx>=0.24.0
  fastapi>=0.100.0
  starlette>=0.30.0
  uvicorn[standard]>=0.22.0
  uvloop>=0.17.0
  ```

### 3.2 模块职责

| 模块 | 职责 | 注意事项 |
|------|------|---------|
| `config.py` | 项目路径常量 | 只放路径配置，不放业务逻辑 |
| `database.py` | SQLite CRUD | 所有数据库操作集中此处，禁止在其他模块直接操作 SQLite |
| `mk_logger.py` | 统一日志 | 使用 `log_info/log_warn/log_error`，**禁止直接 `print()`** |
| `mk_plugin.py` | ZLM 插件入口 | 实现 `on_start/on_exit/on_publish/on_play` 等回调 |
| `py_http_api.py` | FastAPI 路由 | 所有 Python 侧 HTTP API 定义在此 |
| `shared_loop.py` | 异步事件循环 | 全局唯一 asyncio loop，供跨线程协程使用 |

### 3.3 API 路由命名规范

- **Python API 路径前缀**：`/index/pyapi/`（区别于 ZLM 原生的 `/index/api/`）
- **命名风格**：小写 + 下划线（`snake_case`），例如：
  - `GET /index/pyapi/get_protocol_options_list`
  - `POST /index/pyapi/add_protocol_options`
  - `POST /index/pyapi/update_protocol_options`
  - `POST /index/pyapi/delete_protocol_options`

### 3.4 API 响应格式规范

所有 Python API 必须与 ZLMediaKit 的响应格式保持一致：

```python
# 成功
{"code": 0, "msg": "操作成功", "data": {...}}

# 失败  
{"code": -1, "msg": "失败原因描述"}
```

**code 取值约定**（与 ZLMediaKit 对齐）：

| code | 含义 |
|------|------|
| `0` | 成功 |
| `-1` | 业务失败（OtherFailed） |
| `-100` | 鉴权失败（AuthFailed） |
| `-200` | SQL 执行失败（SqlFailed） |
| `-300` | 参数非法（InvalidArgs） |
| `-400` | 代码抛异常（Exception） |

### 3.5 请求参数解析规范

FastAPI 路由**必须同时支持** JSON body、form-urlencoded、GET query 三种传参方式。  
使用已有的 `get_param_from_request()` 工具函数，或按以下顺序解析：
1. Query 参数
2. Body（JSON / form）
3. Header

```python
async def my_api(request: Request):
    body_bytes = await request.body()
    content_type = request.headers.get("content-type", "")
    
    if "application/json" in content_type or not content_type:
        data = json.loads(body_bytes.decode("utf-8"))
    elif "application/x-www-form-urlencoded" in content_type:
        parsed = urllib.parse.parse_qs(body_bytes.decode("utf-8"), keep_blank_values=True)
        data = {k: v[0] if len(v) == 1 else v for k, v in parsed.items()}
    # ...
```

### 3.6 调用 ZLMediaKit HTTP API 规范

Python 后端转发请求给 ZLMediaKit 时，**必须**使用以下两个统一工具函数，禁止手动拼接 URL 或手动透传 cookie：

#### `get_zlm_base_url()` — 获取 ZLM 内部访问地址

```python
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
```

- `http.port` 非 0 时使用 HTTP；为 0 时表示 HTTP 被禁用，自动切换 HTTPS + `http.ssl_port`
- **禁止**硬编码 `http://127.0.0.1:8080` 等端口

#### `get_forward_headers(request)` — 透传客户端 Cookie

```python
def get_forward_headers(request: Request) -> dict:
    """从入站请求中提取需要透传给 ZLMediaKit 的 headers（目前仅 cookie）。"""
    headers: dict = {}
    cookie = request.headers.get("cookie")
    if cookie:
        headers["cookie"] = cookie
    return headers
```

- 所有转发到 ZLM 的请求**必须**透传 cookie，否则会触发 ZLM 鉴权失败（code=-100）

#### 标准调用示例

```python
# ✅ 正确写法
zlm_url = f"{get_zlm_base_url()}/index/api/addStreamProxy"
zlm_params = {
    "vhost": vhost,
    "app": app,
    "stream": stream,
    "url": url,
}
response = await client.post(zlm_url, data=zlm_params, headers=get_forward_headers(request))
result = response.json()

# ❌ 错误写法（不允许）
zlm_url = f"http://127.0.0.1:{mk_loader.get_config('http.port')}/index/api/addStreamProxy"
response = await client.post(zlm_url, data=zlm_params)   # 缺少 cookie 透传
```

- `client` 使用模块级全局 `httpx.AsyncClient` 单例，**不要**在每次请求中 `async with httpx.AsyncClient()`
- ZLM API 参数使用 form-data（`data=`），不是 JSON（`json=`）

### 3.7 数据库规范

- 数据库文件路径从 `config.DATABASE_PATH` 获取，不硬编码
- 全局唯一 `Database` 实例（`db = Database()`），在 `py_http_api.py` 模块级初始化
- 字段更新使用动态 `SET` 子句，更新时必须同步更新 `updated_at`
- 流的唯一键由 `(vhost, app, stream)` 三元组组成，数据库层做 UNIQUE 约束
- JSON 类型数据（如 `custom_params`）存储为 JSON 字符串

### 3.8 FastAPI 路由文档规范

每个路由必须有：
- `tags`（按业务模块分组，如 `["拉流代理"]`、`["转协议预设"]`）
- `summary`（中文简短说明）
- docstring（详细参数说明）

```python
@app.post(
    "/index/pyapi/addStreamProxy",
    tags=["拉流代理"],
    summary="添加拉流代理",
)
async def add_stream_proxy(request: Request):
    """
    添加拉流代理并同步到 ZLMediaKit
    
    参数：
    - vhost: 虚拟主机，默认 __defaultVhost__
    - app: 应用名（必选）
    - stream: 流ID（必选）
    - url: 拉流地址（必选）
    """
```

### 3.9 mk_plugin.py 回调规范

| 回调函数 | 说明 | 返回 True 含义 |
|----------|------|----------------|
| `on_start()` | 插件启动时调用，初始化配置 | - |
| `on_exit()` | 插件退出时调用 | - |
| `on_publish(type, args, invoker, sender)` | 推流鉴权 | 事件被 Python 拦截 |
| `on_play(args, invoker, sender)` | 播放鉴权 | 事件被 Python 拦截 |
| `on_flow_report(...)` | 流量上报 | 事件被 Python 拦截 |
| `on_media_changed(is_register, sender)` | 流注册/注销 | False = C++ 也处理 |
| `on_player_proxy_failed(url, ...)` | 拉流代理失败 | False = C++ 也处理 |

`on_start()` 中**必须**执行：
```python
mk_loader.set_config('api.legacyAuth', "0")       # 强制 cookie 登录
mk_loader.set_config('http.rootPath', frontend_path)  # 设置前端静态文件目录
mk_loader.update_config()
mk_loader.set_fastapi(check_route, submit_coro)   # 注册 FastAPI 到 ZLM
```

---

## 四、前端开发规范（HTML / CSS / JavaScript）

### 4.1 技术栈

| 技术 | 引入方式 | 说明 |
|------|----------|------|
| Tailwind CSS | CDN（`cdn.tailwindcss.com`） | 主要 UI 框架 |
| Font Awesome 4.7 | CDN | 图标库 |
| Chart.js 4.x | CDN | 图表 |
| hls.js | CDN | HLS 播放 |
| Jessibuca | `js/lib/` 本地 | WebRTC/FLV 播放器 |

> **注意**：不引入 Vue/React 等前端框架，保持原生 JS。

### 4.2 页面组织

- `index.html`：主框架，包含侧边导航栏、顶部栏、iframe 容器
- `login.html`：独立登录页
- `pages/*.html`：各功能子页面，通过 `<iframe>` 嵌入主框架
- 各子页面引入对应的 `js/*.js` 功能模块

### 4.3 主题与色彩规范

```javascript
// Tailwind 主题配置（index.html 中定义）
colors: {
    primary: '#6366f1',    // 主色调（紫色）
    secondary: '#8b5cf6',  // 辅助色
    accent: '#ec4899',     // 强调色（粉色）
    dark: '#1e293b',       // 深色背景
    light: '#f8fafc',      // 浅色
}
```

常用 CSS 渐变类：
- `bg-gradient-primary`：主色渐变按钮/卡片
- `bg-gradient-secondary`：深色背景渐变
- `bg-gradient-accent`：强调色渐变
- `text-gradient`：渐变文字
- `hover:shadow-neon`：霓虹光晕悬停效果

### 4.4 API 调用规范（前端）

所有 API 调用**必须**通过 `api.js` 中的 `Api` 对象，禁止直接 `fetch`：

```javascript
// ✅ 正确
const result = await Api.getMediaList();
const result = await Api.request('/index/api/someApi', { body: {...} });

// ❌ 错误
const result = await fetch('/index/api/someApi', {...});
```

**在 `api.js` 的 `Api` 对象中新增方法时遵循命名规范**：

| API 类型 | 前端方法命名 | 示例 |
|----------|-------------|------|
| ZLM 原生 GET | `get*` | `getMediaList()` |
| ZLM 原生操作 | 动词+名词 | `closeStream()` |
| Python API GET | `get*` | `getProtocolOptionsList()` |
| Python API 增 | `add*` | `addStreamProxy()` |
| Python API 改 | `update*` | `updateProtocolOptions()` |
| Python API 删 | `delete*` | `deleteProtocolOptions()` |

**`Api.request()` 默认参数**：

```javascript
// 默认 POST，JSON body，携带 cookie
Api.request(path, {
    method: 'POST',          // 可改为 'GET'
    body: { key: 'value' },  // 自动序列化为 JSON
})
```

### 4.5 认证机制

ZLMediaKit 使用 cookie + digest 认证（`api.legacyAuth=0` 模式）：

1. 调用 `/index/api/getApiList` → 获取 `cookie`（code=-100 时响应体携带）
2. 计算 `digest = MD5("zlmediakit:" + secret + ":" + cookie)`
3. 调用 `/index/api/login?digest=xxx` 完成登录
4. 后续请求自动携带浏览器 session cookie（`credentials: 'include'`）

认证状态检查使用 `checkAuth()`（在 `api.js` 中定义），所有子页面加载时调用。

### 4.6 页面功能模块规范

每个功能页面的 JS 文件应遵循以下结构：

```javascript
// 1. 初始化函数（页面加载时调用）
function init<ModuleName>() {
    load<ModuleName>();
    // 绑定事件监听器
}

// 2. 加载数据函数
async function load<ModuleName>() {
    // 显示 loading 状态
    // 调用 API
    // 渲染数据到表格/列表
    // 处理错误
}

// 3. 操作函数（增删改）
async function add<Item>() {}
async function update<Item>() {}
async function delete<Item>() {}

// 4. 清理函数（页面切换时调用，释放播放器/定时器等资源）
function cleanup<ModuleName>() {}
```

### 4.7 Loading 状态规范

所有数据加载必须显示 loading 动画：

```javascript
tbody.innerHTML = `
    <tr>
        <td colspan="8" class="p-10 text-center">
            <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto mb-4"></div>
            <span class="text-white/60 font-semibold">加载中...</span>
        </td>
    </tr>
`;
```

### 4.8 Toast 通知规范

使用 `showToast(message, type, duration)` 展示操作反馈：

```javascript
showToast('操作成功', 'success');          // 成功（绿色）
showToast('操作失败: ' + result.msg, 'error');  // 失败（红色）
showToast('注意事项', 'warning');          // 警告（黄色）
showToast('提示信息', 'info');             // 信息（蓝色）
```

### 4.9 确认弹窗规范

危险操作（删除/停止/踢出等）必须使用 `showConfirmModal()` 二次确认：

```javascript
showConfirmModal(
    '确认删除',
    '确定要删除该拉流代理吗？此操作不可恢复。',
    async function() {
        // 执行删除操作
    }
);
```

### 4.10 表格渲染规范

表格列对应字段不存在时统一显示 `'-'`，不显示 `undefined` 或空字符串：

```javascript
html += `<td class="p-4 text-white">${item.field || '-'}</td>`;
```

---

## 五、ZLMediaKit HTTP API 使用规范

### 5.1 API 分类速查

**流管理**

| 接口 | 方法 | 说明 |
|------|------|------|
| `/index/api/getMediaList` | GET/POST | 获取流列表，支持 schema/vhost/app/stream 过滤 |
| `/index/api/getMediaInfo` | GET/POST | 获取单路流信息（已过期，推荐用 getMediaList） |
| `/index/api/close_streams` | GET/POST | 关闭流（支持批量过滤） |
| `/index/api/isMediaOnline` | GET/POST | 判断流是否在线（已过期） |

**拉流代理**

| 接口 | 方法 | 说明 |
|------|------|------|
| `/index/api/addStreamProxy` | GET/POST | 添加 RTSP/RTMP/HLS 拉流代理 |
| `/index/api/delStreamProxy` | GET/POST | 删除拉流代理（参数：key） |
| `/index/api/listStreamProxy` | GET/POST | 获取拉流代理列表 |
| `/index/api/getProxyInfo` | GET/POST | 获取拉流代理详情（参数：key） |

**推流代理**

| 接口 | 方法 | 说明 |
|------|------|------|
| `/index/api/addStreamPusherProxy` | GET/POST | 添加推流代理（转推） |
| `/index/api/delStreamPusherProxy` | GET/POST | 删除推流代理 |
| `/index/api/listStreamPusherProxy` | GET/POST | 获取推流代理列表 |
| `/index/api/getProxyPusherInfo` | GET/POST | 获取推流代理详情 |

**FFmpeg 代理**

| 接口 | 方法 | 说明 |
|------|------|------|
| `/index/api/addFFmpegSource` | GET/POST | 通过 FFmpeg 拉流代理（支持任意协议） |
| `/index/api/delFFmpegSource` | GET/POST | 删除 FFmpeg 拉流代理 |
| `/index/api/listFFmpegSource` | GET/POST | 获取 FFmpeg 代理列表 |

**录制管理**

| 接口 | 方法 | 说明 |
|------|------|------|
| `/index/api/startRecord` | GET/POST | 开始录制（type: 0=HLS, 1=MP4） |
| `/index/api/stopRecord` | GET/POST | 停止录制 |
| `/index/api/isRecording` | GET/POST | 查询录制状态 |
| `/index/api/getMP4RecordFile` | GET/POST | 获取录像文件列表 |
| `/index/api/deleteRecordDirectory` | GET/POST | 删除录像文件夹 |
| `/index/api/startRecordTask` | GET/POST | 事件录制（支持回溯） |

**服务器管理**

| 接口 | 方法 | 说明 |
|------|------|------|
| `/index/api/getServerConfig` | GET/POST | 获取服务器配置 |
| `/index/api/setServerConfig` | GET/POST | 修改服务器配置 |
| `/index/api/restartServer` | GET/POST | 重启服务器 |
| `/index/api/getStatistic` | GET/POST | 获取对象统计信息 |
| `/index/api/getThreadsLoad` | GET/POST | 获取 epoll 线程负载 |
| `/index/api/getWorkThreadsLoad` | GET/POST | 获取工作线程负载 |
| `/index/api/version` | GET/POST | 获取版本信息 |

**网络连接管理**

| 接口 | 方法 | 说明 |
|------|------|------|
| `/index/api/getAllSession` | GET/POST | 获取所有 TCP 连接 |
| `/index/api/kick_session` | GET/POST | 断开指定 TCP 连接（参数：id） |
| `/index/api/kick_sessions` | GET/POST | 批量断开 TCP 连接 |
| `/index/api/getMediaPlayerList` | GET/POST | 获取流观看者列表 |

**截图**

| 接口 | 方法 | 说明 |
|------|------|------|
| `/index/api/getSnap` | GET | 获取截图（返回 jpeg 图片） |
| `/index/api/deleteSnapDirectory` | GET/POST | 删除截图文件/文件夹 |

**GB28181 / RTP**

| 接口 | 方法 | 说明 |
|------|------|------|
| `/index/api/openRtpServer` | GET/POST | 创建 RTP 接收端口 |
| `/index/api/closeRtpServer` | GET/POST | 关闭 RTP 接收端口 |
| `/index/api/listRtpServer` | GET/POST | 列出所有 RTP 服务器 |
| `/index/api/startSendRtp` | GET/POST | 启动 PS-RTP 推流（GB28181 客户端） |
| `/index/api/startSendRtpPassive` | GET/POST | 启动 PS-RTP 被动推流 |
| `/index/api/stopSendRtp` | GET/POST | 停止 RTP 推流 |
| `/index/api/getRtpInfo` | GET/POST | 获取 RTP 流信息 |

**WebRTC**

| 接口 | 方法 | 说明 |
|------|------|------|
| `/index/api/webrtc` | POST | WebRTC 播放/推流（SDP 交换） |
| `/index/api/whip` | POST | WHIP 标准推流接口 |
| `/index/api/whep` | POST | WHEP 标准播放接口 |
| `/index/api/delete_webrtc` | DELETE | 删除 WebRTC 连接 |

**多画面拼接**

| 接口 | 方法 | 说明 |
|------|------|------|
| `/index/api/stack/start` | POST | 启动多视频拼接（宫格） |
| `/index/api/stack/reset` | POST | 更新拼接参数 |
| `/index/api/stack/stop` | GET | 停止拼接 |

**点播**

| 接口 | 方法 | 说明 |
|------|------|------|
| `/index/api/loadMP4File` | GET/POST | 点播 MP4 文件生成直播流 |
| `/index/api/setRecordSpeed` | GET/POST | 设置录像播放速度 |
| `/index/api/seekRecordStamp` | GET/POST | 设置录像播放位置 |

**认证**

| 接口 | 方法 | 说明 |
|------|------|------|
| `/index/api/getApiList` | GET/POST | 获取 API 列表（同时用于获取 cookie） |
| `/index/api/login` | GET/POST | 登录（digest 认证） |
| `/index/api/logout` | GET/POST | 登出 |

### 5.2 关键参数说明

**stream 标识规则**

ZLMediaKit 中流的唯一标识（key）格式为：
```
{vhost}/{app}/{stream}
# 例如：__defaultVhost__/live/test
```

**vhost 默认值**：`__defaultVhost__`

**originType 枚举**：

| 值 | 说明 |
|----|------|
| 0 | unknown |
| 1 | rtmp_push（RTMP 推流） |
| 2 | rtsp_push（RTSP 推流） |
| 3 | rtp_push（RTP/GB28181 推流） |
| 4 | pull（拉流代理） |
| 5 | ffmpeg_pull（FFmpeg 拉流代理） |
| 6 | mp4_vod（MP4 点播） |
| 7 | device_chn（设备通道） |

**codec_id 枚举**：

| 值 | 编码 |
|----|------|
| 0 | H.264 |
| 1 | H.265 |
| 2 | AAC |
| 3 | G.711A |
| 4 | G.711U |

**addStreamProxy 转协议参数**（同时适用于 Python 侧 `protocol_options`）：

| 参数 | 类型 | 说明 |
|------|------|------|
| `enable_hls` | bool | 转 HLS-MPEG-TS |
| `enable_hls_fmp4` | bool | 转 HLS-FMP4 |
| `enable_mp4` | bool | MP4 录制 |
| `enable_rtsp` | bool | 转 RTSP/WebRTC |
| `enable_rtmp` | bool | 转 RTMP/FLV |
| `enable_ts` | bool | 转 HTTP-TS/WS-TS |
| `enable_fmp4` | bool | 转 HTTP-FMP4/WS-FMP4 |
| `enable_audio` | bool | 转协议时是否携带音频 |
| `add_mute_audio` | bool | 无音频时添加静音 AAC |
| `hls_demand` | bool | HLS 按需生成 |
| `rtsp_demand` | bool | RTSP 按需生成 |
| `rtmp_demand` | bool | RTMP 按需生成 |
| `ts_demand` | bool | HTTP-TS 按需生成 |
| `fmp4_demand` | bool | HTTP-FMP4 按需生成 |
| `mp4_save_path` | string | MP4 保存路径 |
| `mp4_max_second` | int | MP4 切片大小（秒） |
| `mp4_as_player` | bool | MP4 录制是否计入观看人数 |
| `hls_save_path` | string | HLS 保存路径 |
| `modify_stamp` | int | 时间戳处理（0=绝对/1=系统/2=相对） |
| `auto_close` | bool | 无人观看自动关闭 |
| `continue_push_ms` | int | 推流断开后保留时间（毫秒） |

---

## 六、Python API 说明（当前已实现）

### 6.1 系统性能

| 路径 | 方法 | 说明 |
|------|------|------|
| `/index/pyapi/host-stats` | GET | 获取 CPU/内存/磁盘/网络速率 |

响应示例：
```json
{
    "code": 0,
    "data": {
        "time": "14:30:00",
        "cpu": 12.5,
        "memory": {"used": 2.1, "total": 8.0},
        "disk": {"used": 50.3, "total": 200.0},
        "network": {"sent": 1024.5, "recv": 2048.3, "sent_total": 10240, "recv_total": 20480}
    }
}
```

### 6.2 转协议预设管理

| 路径 | 方法 | 说明 |
|------|------|------|
| `/index/pyapi/add_protocol_options` | POST | 添加预设 |
| `/index/pyapi/update_protocol_options` | POST | 修改预设 |
| `/index/pyapi/delete_protocol_options` | POST | 删除预设（参数：id） |
| `/index/pyapi/get_protocol_options_list` | GET | 获取预设列表（id/name/created_at） |
| `/index/pyapi/get_protocol_options` | GET | 获取预设详情（参数：id） |

### 6.3 拉流代理管理

| 路径 | 方法 | 说明 |
|------|------|------|
| `/index/pyapi/addStreamProxy` | POST | 添加拉流代理（同步到 ZLM + 写库） |
| `/index/pyapi/delStreamProxy` | POST | 删除拉流代理（同步到 ZLM + 写库，参数：key） |
| `/index/pyapi/getStreamProxyList` | GET | 获取拉流代理列表（从数据库） |
| `/index/pyapi/getStreamProxy` | GET | 获取拉流代理详情（参数：id） |

---

## 七、数据库表结构说明

### 7.1 `pull_proxies` — 拉流代理

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER PK | 自增主键 |
| `vhost` | TEXT | 虚拟主机，默认 `__defaultVhost__` |
| `app` | TEXT | 应用名 |
| `stream` | TEXT | 流 ID |
| `url` | TEXT | 拉流地址 |
| `custom_params` | TEXT | 自定义参数（JSON 字符串） |
| `protocol_params` | TEXT | 转协议参数（JSON 字符串） |
| `enabled` | INTEGER | 是否启用（0/1） |
| `created_at` | TIMESTAMP | 创建时间 |
| `updated_at` | TIMESTAMP | 更新时间 |

唯一约束：`UNIQUE(vhost, app, stream)`

### 7.2 `push_tasks` — 推流任务

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER PK | 自增主键 |
| `name` | TEXT | 任务名称 |
| `app` | TEXT | 应用名 |
| `stream` | TEXT | 流 ID |
| `url` | TEXT | 推流目标地址 |
| `enabled` | INTEGER | 是否启用（0/1） |
| `created_at` | TIMESTAMP | 创建时间 |
| `updated_at` | TIMESTAMP | 更新时间 |

### 7.3 `protocol_options` — 转协议预设

存储用户自定义的转协议参数配置集，字段对应 ZLMediaKit `[protocol]` 配置节。  
所有参数字段类型为 TEXT（NULL 代表使用 ZLM 默认配置）。

### 7.4 `recordings` — 录像记录

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER PK | 自增主键 |
| `app` | TEXT | 应用名 |
| `stream` | TEXT | 流 ID |
| `url` | TEXT | 流 URL |
| `file_path` | TEXT | 录像文件路径 |
| `file_size` | INTEGER | 文件大小（字节） |
| `created_at` | TIMESTAMP | 录像时间 |

---

## 八、已知问题与待修复事项

> AI 辅助开发时请注意以下已知代码问题：

1. **`database.py` 部分方法**中使用裸 `print()` 而非 `mk_logger`，后续统一替换为 `mk_logger.log_warn()`。

2. **`py_http_api.py` 部分 POST 接口**：每个接口都重复实现了 body 解析逻辑，应重构为共享的 `parse_request_body()` 工具函数（`get_param_from_request()` 已有单字段版本，可参考扩展为整体 body 解析）。

3. **`push_tasks` 表**已创建但暂无对应 API，待实现推流代理（转推）管理功能。

---

## 九、新功能开发指引

### 9.1 新增一个管理功能模块的完整步骤

1. **数据库层**（`database.py`）：
   - 在 `_create_tables()` 中添加建表 SQL
   - 实现 `add_*`、`get_*`、`get_all_*`、`update_*`、`delete_*` 方法

2. **Python API 层**（`py_http_api.py`）：
   - 添加 `@app.get/post` 路由，路径格式 `/index/pyapi/操作_资源`
   - 如需联动 ZLMediaKit，通过 `httpx` 调用对应 `/index/api/` 接口

3. **前端 API 封装**（`js/api.js`）：
   - 在 `Api` 对象中添加对应方法

4. **前端页面**（`pages/xxx.html` + `js/xxx.js`）：
   - 参照现有模块实现 `init/load/add/update/delete` 函数体

5. **主框架导航**（`index.html`）：
   - 在侧边栏添加导航项和 iframe 切换逻辑

### 9.2 调用 ZLMediaKit 播放 URL 规则

```
# RTMP
rtmp://{host}:1935/{app}/{stream}

# HTTP-FLV
http://{host}:8080/{app}/{stream}.live.flv

# HLS
http://{host}:8080/{app}/{stream}/hls.m3u8

# HTTP-FMP4
http://{host}:8080/{app}/{stream}.live.mp4

# WebSocket-FLV
ws://{host}:8080/{app}/{stream}.live.flv

# RTSP
rtsp://{host}:8554/{app}/{stream}

# WebRTC (WHEP)
POST http://{host}:8080/index/api/whep?app={app}&stream={stream}
```

### 9.3 生成代码时的注意事项

- **不要**在 Python 代码中使用 `print()`，统一使用 `mk_logger.log_info/warn/error()`
- **不要**在前端代码中直接使用 `fetch()`，统一通过 `Api.request()`
- **不要**硬编码 ZLMediaKit 的 port 和 secret，从 `mk_loader.get_config()` 获取
- 新增数据库表时，`updated_at` 字段通过 `ON UPDATE` 触发器或手动在代码中更新
- 前端新页面使用 Tailwind CSS 时，遵循深色主题风格（`bg-dark`、`text-white`）
- Python API 请求体解析须容忍 `content-type` 缺失的情况（默认当 JSON 处理）
- ZLM API 中的布尔值参数：传 `1`/`0` 或 `true`/`false` 均可；数据库存储转协议参数时统一存为字符串

---

## 十、参考资源

- ZLMediaKit HTTP API 文档：https://github.com/zlmediakit/ZLMediaKit/wiki/MediaServer%E6%94%AF%E6%8C%81%E7%9A%84HTTP-API
- ZLMediaKit Web Hook API：https://github.com/zlmediakit/ZLMediaKit/wiki/MediaServer%E6%94%AF%E6%8C%81%E7%9A%84HTTP-HOOK-API
- ZLMediaKit 配置文件详解：https://github.com/zlmediakit/ZLMediaKit/wiki/%E9%85%8D%E7%BD%AE%E6%96%87%E4%BB%B6%E8%AF%A6%E8%A7%A3
- ZLMediaKit 播放 URL 规则：https://github.com/zlmediakit/ZLMediaKit/wiki/%E6%92%AD%E6%94%BEurl%E8%A7%84%E5%88%99
- FastAPI 官方文档：https://fastapi.tiangolo.com/
- Tailwind CSS 文档：https://tailwindcss.com/docs
