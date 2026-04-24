"""
录像自动清理插件（on_start 类型）

服务启动时启动后台定时任务，按以下规则清理每条流的旧录像：
  - max_size_gb：每条流最多保留录像总大小（GB），默认 10
  - max_days：每条流最多保留录像天数，默认 7

超出限制时，按 start_time 从旧到新依次删除数据库记录 **并删除实际文件**，
直到满足限制为止。
"""

import os
import time
import threading
import json

import mk_logger
from py_plugin import PluginBase


_CHECK_INTERVAL_SEC  = 3600   # 每小时检查一次


def _do_cleanup(max_size_bytes: float, max_days: int):
    """执行一次清理，遍历所有流"""
    try:
        from py_http_api import db
        streams = db.get_recording_streams()
    except Exception as e:
        mk_logger.log_warn(f"[record_cleanup] 获取流列表失败: {e}")
        return

    now_ts     = time.time()
    cutoff_ts  = now_ts - max_days * 86400

    for s in streams:
        vhost  = s.get("vhost", "")
        app    = s.get("app", "")
        stream = s.get("stream", "")

        try:
            # 取该流所有录像，按时间升序（最旧在前）
            rows = db.get_recordings(vhost=vhost, app=app, stream=stream,
                                     limit=100000, offset=0)
            rows.sort(key=lambda r: r.get("start_time") or 0)
        except Exception as e:
            mk_logger.log_warn(f"[record_cleanup] 查询录像失败 {app}/{stream}: {e}")
            continue

        if not rows:
            continue

        # 统计当前总大小
        total_size = sum(r.get("file_size") or 0 for r in rows)

        for r in rows:
            should_delete = False
            reason = ""

            start_time = r.get("start_time") or 0
            if start_time and start_time < cutoff_ts:
                should_delete = True
                reason = f"超过 {max_days} 天"
            elif total_size > max_size_bytes:
                should_delete = True
                reason = f"总大小 {total_size/1024**3:.2f}GB 超出 {max_size_bytes/1024**3:.1f}GB"

            if not should_delete:
                continue

            file_path  = r.get("file_path", "")
            file_size  = r.get("file_size") or 0
            rec_id     = r.get("id")

            # 删除文件
            if file_path and os.path.isfile(file_path):
                try:
                    os.remove(file_path)
                    mk_logger.log_info(
                        f"[record_cleanup] 已删文件 {file_path}（{reason}）"
                    )
                except Exception as e:
                    mk_logger.log_warn(f"[record_cleanup] 删除文件失败 {file_path}: {e}")

            # 删除数据库记录
            try:
                if rec_id is not None:
                    db.delete_recording(int(rec_id))
                total_size -= file_size
                mk_logger.log_info(
                    f"[record_cleanup] 已删记录 id={rec_id} {app}/{stream} {reason}"
                )
            except Exception as e:
                mk_logger.log_warn(f"[record_cleanup] 删除记录失败 id={rec_id}: {e}")


def _cleanup_loop(max_size_bytes: float, max_days: int):
    """后台循环线程"""
    mk_logger.log_info(
        f"[record_cleanup] 清理线程启动，"
        f"最大 {max_size_bytes/1024**3:.1f}GB / {max_days} 天，"
        f"间隔 {_CHECK_INTERVAL_SEC}s"
    )
    while True:
        try:
            _do_cleanup(max_size_bytes, max_days)
        except Exception as e:
            mk_logger.log_warn(f"[record_cleanup] 清理异常: {e}")
        time.sleep(_CHECK_INTERVAL_SEC)


class RecordCleanup(PluginBase):
    name        = "record_cleanup"
    version     = "1.0.0"
    description = (
        "录像自动清理插件（on_start）。"
        "按流统计总大小和录像日龄，超限时从最旧录像开始删除文件及数据库记录。"
    )
    type        = "on_start"
    exclusive   = False

    def params(self) -> dict:
        return {
            "max_size_gb": {
                "type": "number",
                "default": 10,
                "description": "每条流最多保留录像总大小（GB），超出则从最旧录像开始删除"
            },
            "max_days": {
                "type": "number",
                "default": 7,
                "description": "每条流最多保留录像天数，超出则删除过期录像"
            },
        }

    def run(self, **kwargs) -> bool:
        # 从绑定参数中读取配置（可在插件管理页面修改）
        # 未配置时回落到 params() 中定义的默认值
        schema       = self.params()
        bound_params = kwargs.get("params", {})
        if isinstance(bound_params, str):
            try:
                bound_params = json.loads(bound_params)
            except Exception:
                bound_params = {}

        def _get(key):
            return bound_params.get(key, schema[key]["default"])

        max_size_gb    = float(_get("max_size_gb"))
        max_days       = int(_get("max_days"))
        max_size_bytes = max_size_gb * 1024 ** 3

        t = threading.Thread(
            target=_cleanup_loop,
            args=(max_size_bytes, max_days),
            daemon=True,
            name="record-cleanup",
        )
        t.start()
        return False  # 非独占
