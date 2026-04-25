"""
HTTP 访问控制内置插件
- http_access_frontend: 处理 on_http_access，限制只允许访问 frontend 目录。
默认启用，不建议禁用（禁用后 ZLM 将使用自身默认路径策略）。
"""

import os
import mk_loader
import mk_logger
from py_plugin import PluginBase


class HttpAccessFrontend(PluginBase):
    """
    HTTP 访问控制插件（on_http_access）
    只允许访问 frontend 目录下的文件，拒绝越界访问。
    独占型：处理后直接返回，不再继续其他插件。
    """
    name = "http_access_frontend"
    version = "1.0.0"
    description = "HTTP 访问控制，限制只允许访问 frontend 目录。默认启用，不建议禁用。"
    type = "on_http_access"
    interruptible = True

    def run(self, **kwargs) -> bool:
        file_path = kwargs.get("file_path", "")
        path      = kwargs.get("path", "")
        invoker   = kwargs.get("invoker")

        current_dir   = os.path.dirname(os.path.abspath(__file__))
        frontend_path = os.path.abspath(os.path.join(current_dir, '..', '..', 'frontend'))

        if not file_path.startswith(frontend_path):
            mk_logger.log_warn(f"[http_access_frontend] Access denied: '{file_path}' is outside frontend directory")
            mk_loader.http_access_invoker_do(invoker, "Access denied by pymkui", path, 60 * 60)
            return True

        mk_loader.http_access_invoker_do(invoker, "", path, 60 * 60)
        return True
