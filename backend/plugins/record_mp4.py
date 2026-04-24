"""
MP4 录像入库插件（on_record_mp4）
非独占，录像完成后将文件信息写入 recordings 表。
"""

import mk_logger
from py_plugin import PluginBase


class RecordMp4Logger(PluginBase):
    name        = "record_mp4_logger"
    version     = "1.0.0"
    description = "MP4 录像完成后自动将录像信息写入数据库，供录像管理页面查询。"
    type        = "on_record_mp4"
    exclusive   = False

    def run(self, **kwargs) -> bool:
        info = kwargs.get("info", {})
        if not isinstance(info, dict):
            return False
        try:
            from py_http_api import db
            db.add_recording(info)
            mk_logger.log_info(
                f"[record_mp4_logger] 写库成功: {info.get('app')}/{info.get('stream')} "
                f"{info.get('file_name')} size={info.get('file_size')}"
            )
        except Exception as e:
            mk_logger.log_warn(f"[record_mp4_logger] 写库失败: {e}")
        return False  # 非独占，继续派发后续插件
