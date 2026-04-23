from sys import version
import os
import sys
import importlib
import importlib.util
import inspect
import threading

import mk_logger

# ── 所有 ZLM 支持的事件类型 ──────────────────────────────────────────
SUPPORTED_EVENTS = [
    "on_publish",
    "on_play",
    "on_stream_not_found",
    "on_stream_none_reader",
    "on_record_mp4",
    "on_record_ts",
    "on_media_changed",
    "on_flow_report",
    "on_http_access",
    "on_player_proxy_failed",
    "on_send_rtp_stopped",
    "on_rtp_server_timeout",
    "on_get_rtsp_realm",
    "on_rtsp_auth",
]


class PluginBase:
    name = "base"
    version = "0.0.1"
    description = "Base plugin class"
    # type 必须是 SUPPORTED_EVENTS 中的一个
    type = "base"
    # exclusive=True  → 独占型：run() 返回 True 后立即停止后续插件派发
    #                   适用于鉴权等需要独占事件控制权的场景
    # exclusive=False → 监听型：无论 run() 返回什么，都继续执行后续插件
    #                   适用于日志记录、消息推送、写库等不影响业务流程的旁路处理
    exclusive = True

    def before_run(self, **kwargs):
        raise NotImplementedError

    def run(self, **kwargs):
        raise NotImplementedError
    
    def params(self) -> dict:
        """
        可选方法，返回一个 dict 定义插件绑定参数的 schema 结构。
        例如：
        {
            "push_url": {
                "type": "string",
                "default": "https://default.example.com",
                "description": "推流地址"
            },
            ...
        }
        """
        return {}

class PluginRegistry:
    """
    全局插件注册中心，负责：
    - 扫描并加载 plugins/ 目录下的插件（支持热加载）
    - 维护 事件类型 → [{"name": ..., "params": {...}}, ...] 的绑定关系
    - 线程安全地分发事件到已绑定的插件
    """
    _lock = threading.RLock()

    def __init__(self):
        # name → PluginBase 实例
        self._plugins: dict[str, PluginBase] = {}
        # event_type → list[{"name": str, "params": dict}]（已启用的绑定，有序）
        self._bindings: dict[str, list[dict]] = {}

    # ── 加载 / 热加载 ─────────────────────────────────────────────

    def load(self, plugin_dir: str = "plugins") -> dict:
        """
        扫描 plugin_dir 目录，加载（或重新加载）所有插件模块。
        热加载前先清空已注册的插件，避免残留已删除或改名的插件。
        返回本次加载到的 {name: instance} 字典。
        """
        current_dir = os.path.dirname(os.path.abspath(__file__))
        plugin_path = os.path.join(current_dir, plugin_dir)
        loaded = {}

        if not os.path.isdir(plugin_path):
            mk_logger.log_warn(f"[PluginRegistry] 插件目录不存在: {plugin_path}")
            return loaded

        # 热加载前清空插件注册表
        with self._lock:
            self._plugins.clear()
            mk_logger.log_info("[PluginRegistry] 已清空插件注册表，开始重新加载...")

        for filename in sorted(os.listdir(plugin_path)):
            if not filename.endswith(".py") or filename.startswith("_"):
                continue
            module_name = f"{plugin_dir}.{filename[:-3]}"
            try:
                # 已加载过则 reload，否则 import
                if module_name in sys.modules:
                    module = importlib.reload(sys.modules[module_name])
                    mk_logger.log_info(f"[PluginRegistry] 热重载模块: {module_name}")
                else:
                    module = importlib.import_module(module_name)
                    mk_logger.log_info(f"[PluginRegistry] 加载模块: {module_name}")

                for cls_name, obj in inspect.getmembers(module, inspect.isclass):
                    if issubclass(obj, PluginBase) and obj is not PluginBase:
                        instance = obj()
                        with self._lock:
                            self._plugins[instance.name] = instance
                        loaded[instance.name] = instance
                        mk_logger.log_info(
                            f"[PluginRegistry] 注册插件: {instance.name} "
                            f"v{instance.version} type={instance.type}"
                        )
            except Exception as e:
                mk_logger.log_warn(f"[PluginRegistry] 加载 {module_name} 失败: {e}")

        return loaded

    # ── 查询 ──────────────────────────────────────────────────────

    def get_all(self) -> list[dict]:
        """返回所有已加载插件的信息列表（含参数 schema）"""
        with self._lock:
            result = []
            for p in self._plugins.values():
                try:
                    schema = p.params() if callable(getattr(p, 'params', None)) else {}
                except Exception:
                    schema = {}
                result.append({
                    "name": p.name,
                    "version": p.version,
                    "description": p.description,
                    "type": p.type,
                    "exclusive": p.exclusive,
                    "params_schema": schema,
                })
            return result

    def get(self, name: str) -> "PluginBase | None":
        with self._lock:
            return self._plugins.get(name)

    # ── 绑定管理 ──────────────────────────────────────────────────

    def set_bindings(self, event_type: str, bindings: list):
        """
        设置某个事件类型已启用的绑定列表（全量替换）。

        bindings 格式（两种均支持）：
          - 旧格式：["plugin_name1", "plugin_name2"]
          - 新格式：[{"name": "plugin_name1", "params": {...}}, ...]

        无效插件名（不存在或类型不匹配）会被跳过并记录警告。
        """
        with self._lock:
            valid = []
            for item in bindings:
                # 兼容旧格式 str
                if isinstance(item, str):
                    item = {"name": item, "params": {}}
                n = item.get("name", "")
                params = item.get("params") or {}
                if n not in self._plugins:
                    mk_logger.log_warn(f"[PluginRegistry] 绑定时插件不存在: {n}")
                    continue
                p = self._plugins[n]
                if p.type != event_type:
                    mk_logger.log_warn(
                        f"[PluginRegistry] 插件类型不匹配: {n}.type={p.type} != {event_type}"
                    )
                    continue
                valid.append({"name": n, "params": params})
            self._bindings[event_type] = valid
            mk_logger.log_info(
                f"[PluginRegistry] 绑定更新: {event_type} → "
                f"{[v['name'] for v in valid]}"
            )

    def get_bindings(self) -> dict:
        with self._lock:
            return dict(self._bindings)

    # ── 事件分发 ──────────────────────────────────────────────────

    def dispatch(self, event_type: str, **kwargs) -> bool:
        """
        将事件分发给所有绑定到 event_type 且已启用的插件。

        独占型插件（exclusive=True）：
          run() 返回 True → 立即停止后续所有插件并返回 True（接管事件）
          run() 返回 False → 继续执行下一个插件

        监听型插件（exclusive=False）：
          无论 run() 返回什么 → 始终继续执行后续插件，本插件不影响最终接管结果

        全部插件执行完后若没有任何独占插件接管 → 返回 False
        """
        with self._lock:
            items = list(self._bindings.get(event_type, []))

        intercepted = False
        for item in items:
            name   = item.get("name", "")
            params = item.get("params") or {}
            with self._lock:
                plugin = self._plugins.get(name)
            if plugin is None:
                continue
            try:
                result = plugin.run(**kwargs, binding_params=params)
                if plugin.exclusive:
                    if result:
                        mk_logger.log_info(
                            f"[PluginRegistry] 事件 {event_type} 被独占插件 [{name}] 接管"
                        )
                        intercepted = True
                        break   # 独占接管，终止后续
                else:
                    mk_logger.log_info(
                        f"[PluginRegistry] 监听插件 [{name}] 处理 {event_type} 完成"
                    )
            except Exception as e:
                mk_logger.log_warn(
                    f"[PluginRegistry] 插件 [{name}] 处理 {event_type} 异常: {e}"
                )
        return intercepted


# ── 全局单例 ─────────────────────────────────────────────────────
registry = PluginRegistry()


# ── 兼容旧接口 ───────────────────────────────────────────────────
def load_plugins(plugin_dir: str = "plugins") -> dict:
    """兼容旧调用方式，委托给全局 registry"""
    return registry.load(plugin_dir)