# PyMKUI

PyMKUI是一个为ZLMediakit设计的现代化前端管理界面，提供了直观、美观的视频流管理功能。

## 项目介绍

PyMKUI是基于Web技术开发的前端界面，专为ZLMediakit流媒体服务器打造，提供了以下功能：

- 视频流管理（查看、播放、停止）
- 流信息查看
- 观众列表管理
- 流截图功能
- 服务器状态监控

## 项目结构

```text
pymkui-main/
├─ frontend/              # 静态前端页面（login.html / index.html 等）
├─ backend/               # Python 插件与 FastAPI 接口
│  ├─ mk_plugin.py        # ZLMediaKit Python 插件入口
│  ├─ py_http_api.py      # FastAPI API
│  ├─ database.py         # SQLite 数据库逻辑
│  └─ config.py           # 项目路径与数据库路径配置
├─ data/                  # SQLite 数据目录（运行后生成）
└─ README.md
```

## 与ZLMediakit的关系

ZLMediakit是一个高性能的流媒体服务器，支持RTSP、RTMP、HLS、HTTP-FLV、WebSocket-FLV等多种流媒体协议。PyMKUI作为ZLMediakit的前端管理界面，提供了以下优势：

1. **简化管理**：通过直观的Web界面管理ZLMediakit服务器，无需命令行操作
2. **实时监控**：实时查看流状态、观众数量、码率等信息
3. **便捷操作**：一键播放、停止流，查看详细信息
4. **流截图**：支持获取流截图，便于预览流内容

## 技术栈

- **前端**：HTML5、CSS3、JavaScript
- **样式**：Tailwind CSS
- **图标**：Font Awesome
- **播放器**：原生HTML5视频播放器、Jessibuca（FLV播放）、WHEP（WebRTC播放）

## 界面展示

### 登录页面

![登录页面](image/wechat_2026-03-07_152523_627.png)

### 服务器状态

![服务器状态](image/wechat_2026-03-07_145716_786.png)

### 视频管理页面

![视频管理页面](image/wechat_2026-03-07_145746_419.png)

### 流信息查看

![流信息查看](image/wechat_2026-03-07_152506_741.png)

### 流播放

![流播放](image/wechat_2026-03-07_145756_844.png)

### 观众列表

![观众列表](image/wechat_2026-03-07_145834_262.png)

### 系统设置

![系统设置](image/wechat_2026-03-07_150120_303.png)

### 连接管理

![连接管理](image/wechat_2026-03-07_145637_562.png)

### 在线推流

![在线推流](image/wechat_2026-03-07_150213_341.png)

## 安装使用

### 1. 准备工作

1. 克隆本项目到本地
2. 确保ZLMediakit服务器已经编译安装

### 2. 安装Python依赖

```bash
# 进入backend目录
cd pymkui/backend

# 安装依赖
pip install -r requirements.txt
```

### 3. 配置ZLMediakit

#### 1. 开启Python编译
在`CMakeLists.txt`中配置:
```cmake
option(ENABLE_PYTHON "Enable python plugin" ON)
```
#### 2. 修改ZLMediakit配置文件

  在 `config.ini` 中确认启用了 Python 插件和配置HTTP根目录指向前端
```ini
[python]
plugin=mk_plugin

[http]
rootPath=/path/to/pymkui-main/frontend
```

### 4. 让 ZLMediaKit 能导入 backend Python 文件

做法可以是以下两种之一：

#### 做法 A：设置 `PYTHONPATH`

```bash
export PYTHONPATH=/path/to/pymkui-main/backend:$PYTHONPATH
```

#### 做法 B：在 ZLMediaKit 的 `python/` 目录下建立软链接

例如：

```bash
cd /path/to/ZLMediaKit/release/linux/Debug/python
ln -sf /path/to/pymkui-main/backend/mk_plugin.py mk_plugin.py
ln -sf /path/to/pymkui-main/backend/py_http_api.py py_http_api.py
ln -sf /path/to/pymkui-main/backend/database.py database.py
ln -sf /path/to/pymkui-main/backend/config.py config.py
ln -sf /path/to/pymkui-main/backend/mk_logger.py mk_logger.py
ln -sf /path/to/pymkui-main/backend/shared_loop.py shared_loop.py
```

### 5. 启动服务

1. 启动ZLMediakit服务器
2. 打开浏览器访问 `http://your-server-ip:80/`
3. 输入ZLMediakit服务器地址和secret密钥登录

### 6. 部署检测清单

启动后，建议按这个顺序检查：

#### 1. 进程是否存在

```bash
ps -ef | grep MediaServer
```

#### 2. 端口是否监听

```bash
ss -lntp | grep 80
```

#### 3. 前端文件是否存在

```bash
ls -l /path/to/pymkui-main/frontend/login.html
ls -l /path/to/pymkui-main/frontend/index.html
```

#### 4. 本机 curl 测试静态页

```bash
curl -sv http://your-server-ip:80/login.html
```

正常应返回：

```text
HTTP/1.1 200 OK
```

### 7. 常见问题

#### 1. 页面打不开，curl 提示 `Empty reply from server`

优先检查：

- `mk_plugin.py` 中 `on_http_access` 的参数签名
- ZLMediaKit 版本与当前代码是否兼容

#### 2. `/index/pyapi/*` 返回未登录

这是 API 正常工作时的表现之一，说明 Python API 链路大概率是活的，但你还没有完成登录。

#### 3. rootPath 配了但页面还是 404 或空响应

检查：

- `rootPath` 是否指向 `frontend/`
- `login.html` 文件是否存在
- `on_http_access` 回调是否正常
- Python 插件是否真的成功加载

## 功能特点

- **响应式设计**：适配不同屏幕尺寸
- **实时数据**：实时更新流状态和服务器信息
- **直观操作**：简单易用的界面设计
- **多协议支持**：支持多种流媒体协议的管理
- **流截图**：支持获取和下载流截图

## 注意事项

- 本项目需要与ZLMediakit服务器配合使用
- 确保服务器地址和secret密钥正确
- 部分功能可能需要ZLMediakit特定版本支持

## 贡献

欢迎提交Issue和Pull Request，帮助改进本项目。

## 未来规划

我们计划在未来的版本中实现以下功能：

1. **完善播放、推流鉴权**：加强安全性，实现更灵活的鉴权机制
2. **添加SQLite持久化**：主要用于推拉流任务的持久化，存储配置和历史数据，提高系统可靠性
3. **添加录像文件管理**：实现录像文件的管理、查询和下载功能
4. **添加推拉流代理**：支持更灵活的流分发和转发
5. **Python转码、推理功能**：利用Python的强大生态，实现视频转码和AI推理功能

## 许可证

本项目采用MIT许可证。
