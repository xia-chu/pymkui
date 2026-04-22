from sys import version
import os
import importlib
import inspect

import mk_logger

class PluginBase:
    name = "base"
    version = "0.0.1"
    description = "Base plugin class"
    type = "base"

    def before_run(self, **kwargs):
        raise NotImplementedError

    def run(self, **kwargs):
        raise NotImplementedError


def load_plugins(plugin_dir="plugins"):
    plugins = {}
    current_dir = os.path.dirname(os.path.abspath(__file__))
    plugin_path = os.path.join(current_dir, plugin_dir)
    for filename in os.listdir(plugin_path):
        if not filename.endswith(".py") or filename.startswith("_"):
            continue
        module_name = f"{plugin_dir}.{filename[:-3]}"
        mk_logger.log_info(f"module_name: {module_name}")

        module = importlib.import_module(module_name)
        # 扫描模块里的类
        for name, obj in inspect.getmembers(module, inspect.isclass):
            if issubclass(obj, PluginBase) and obj is not PluginBase:
                instance = obj()
                plugins[instance.name] = instance
                mk_logger.log_info(f"Loaded python plugin: {instance.name}, version: {instance.version}, description: {instance.description}, type: {instance.type}")
    return plugins