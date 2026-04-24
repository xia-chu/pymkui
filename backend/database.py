"""
Database management module for PyMKUI
"""
import os
import sqlite3
import json
from datetime import datetime
from typing import Optional, List, Dict, Any
import config
import mk_logger

class Database:
    def __init__(self, db_path: Optional[str] = None):
        self.db_path = db_path if db_path else config.DATABASE_PATH
        self.connection: sqlite3.Connection
        self.cursor: sqlite3.Cursor
        self.init_db()
    
    def init_db(self):
        """Initialize database connection"""
        self.connection = sqlite3.connect(self.db_path, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.cursor = self.connection.cursor()
        # SQLite 默认不开启外键约束，每次连接后需手动启用
        self.cursor.execute("PRAGMA foreign_keys = ON")
        
        self._create_tables()
    
    def _create_tables(self):
        """Create necessary tables"""
        self.cursor.execute('''
            CREATE TABLE IF NOT EXISTS pull_proxies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                vhost TEXT NOT NULL DEFAULT '__defaultVhost__',
                app TEXT NOT NULL,
                stream TEXT NOT NULL,
                remark TEXT DEFAULT '',
                custom_params TEXT,
                protocol_params TEXT,
                on_demand INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT current_timestamp,
                updated_at TIMESTAMP DEFAULT current_timestamp,
                UNIQUE(vhost, app, stream)
            )
        ''')

        # 多地址表：每条代理可配置多个拉流地址，priority 越小越优先
        # params 字段（JSON）存储该地址专属参数，如 schema、rtp_type 等
        self.cursor.execute('''
            CREATE TABLE IF NOT EXISTS pull_proxy_urls (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                proxy_id INTEGER NOT NULL,
                url TEXT NOT NULL,
                params TEXT DEFAULT '{}',
                priority INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT current_timestamp,
                FOREIGN KEY(proxy_id) REFERENCES pull_proxies(id) ON DELETE CASCADE
            )
        ''')
        
        self.cursor.execute('''
            CREATE TABLE IF NOT EXISTS push_tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                app TEXT not NULL,
                stream TEXT,
                url TEXT,
                enabled INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT current_timestamp,
                updated_at TIMESTAMP DEFAULT current_timestamp
            )
        ''')
        
        self.cursor.execute('''
            CREATE TABLE IF NOT EXISTS recordings (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                vhost       TEXT NOT NULL DEFAULT '__defaultVhost__',
                app         TEXT NOT NULL,
                stream      TEXT NOT NULL,
                file_name   TEXT,
                file_path   TEXT,
                file_size   INTEGER,
                url         TEXT NOT NULL,
                start_time  INTEGER,
                time_len    REAL,
                created_at  TIMESTAMP DEFAULT current_timestamp,
                UNIQUE(file_path)
            )
        ''')
        
        self.cursor.execute('''
            CREATE TABLE IF NOT EXISTS protocol_options (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                modify_stamp TEXT,
                enable_audio TEXT,
                add_mute_audio TEXT,
                auto_close TEXT,
                continue_push_ms TEXT,
                paced_sender_ms TEXT,
                enable_hls TEXT,
                enable_hls_fmp4 TEXT,
                enable_mp4 TEXT,
                enable_rtsp TEXT,
                enable_rtmp TEXT,
                enable_ts TEXT,
                enable_fmp4 TEXT,
                mp4_as_player TEXT,
                mp4_max_second TEXT,
                mp4_save_path TEXT,
                hls_save_path TEXT,
                hls_demand TEXT,
                rtsp_demand TEXT,
                rtmp_demand TEXT,
                ts_demand TEXT,
                fmp4_demand TEXT,
                created_at TIMESTAMP DEFAULT current_timestamp,
                updated_at TIMESTAMP DEFAULT current_timestamp
            )
        ''')

        # 插件事件绑定表：每条记录 = 一个事件类型 + 一个插件的绑定，含参数和优先级
        # priority 越小越先执行；params 为 JSON 对象，存储该绑定的自定义参数
        self.cursor.execute('''
            CREATE TABLE IF NOT EXISTS plugin_bindings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL,
                plugin_name TEXT NOT NULL,
                params TEXT NOT NULL DEFAULT '{}',
                priority INTEGER NOT NULL DEFAULT 0,
                enabled INTEGER NOT NULL DEFAULT 1,
                updated_at TIMESTAMP DEFAULT current_timestamp,
                UNIQUE(event_type, plugin_name)
            )
        ''')

        self.connection.commit()

        # 仅在 plugin_bindings 表为空时（首次建库）插入默认绑定
        self.cursor.execute("SELECT COUNT(*) FROM plugin_bindings")
        if self.cursor.fetchone()[0] == 0:
            self._init_default_plugin_bindings()

        mk_logger.log_info(f"Database initialized at {self.db_path}")

    def _init_default_plugin_bindings(self):
        """插入内置插件的默认绑定记录（仅首次建库、表为空时调用）"""
        defaults = [
            ("on_stream_not_found",    "pull_proxy_on_demand",  "{}", 0, 1),
            ("on_player_proxy_failed", "pull_proxy_failover",   "{}", 0, 1),
            ("on_start",               "pull_proxy_restore",    "{}", 0, 1),
            ("on_http_access",         "http_access_frontend",  "{}", 0, 1),
            ("on_record_mp4",          "record_mp4_logger",     "{}", 0, 1),
        ]
        for event_type, plugin_name, params, priority, enabled in defaults:
            self.cursor.execute(
                """
                INSERT INTO plugin_bindings
                    (event_type, plugin_name, params, priority, enabled)
                VALUES (?, ?, ?, ?, ?)
                """,
                (event_type, plugin_name, params, priority, enabled),
            )
        self.connection.commit()
        mk_logger.log_info("[Database] 默认插件绑定已初始化")
    
    def close(self):
        """Close database connection"""
        if hasattr(self, 'connection') and self.connection:
            self.connection.close()
    
    def add_proxy(self, app: str, stream: str, url: str, enabled: bool = True) -> Optional[Dict[str, Any]]:
        """Add a proxy configuration"""
        try:
            self.cursor.execute(
                'INSERT INTO pull_proxies (app, stream, url, enabled) VALUES (?, ?, ?, ?)',
                (app, stream, url, enabled)
            )
            self.connection.commit()
            proxy_id = self.cursor.lastrowid
            return {
                'id': proxy_id,
                'app': app,
                'stream': stream,
                'url': url,
                'enabled': enabled,
                'created_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                'updated_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            }
        except sqlite3.IntegrityError as e:
            self.connection.rollback()
            raise Exception(f"Failed to add proxy: {e}")
    
    def get_proxy(self, proxy_id: int) -> Optional[Dict[str, Any]]:
        """Get proxy configuration by ID"""
        try:
            self.cursor.execute(
                'SELECT * FROM pull_proxies WHERE id = ?',
                (proxy_id,)
            )
            row = self.cursor.fetchone()
            if row:
                return dict(row)
            return None
        except sqlite3.Error as e:
            mk_logger.log_warn(f"Failed to get proxy: {e}")
            return None
    
    def get_all_proxies(self, enabled_only: bool = True) -> List[Dict[str, Any]]:
        """Get all proxy configurations"""
        try:
            if enabled_only:
                self.cursor.execute(
                    'SELECT * FROM pull_proxies WHERE enabled = 1 ORDER BY created_at DESC'
                )
            else:
                self.cursor.execute(
                    'SELECT * FROM pull_proxies ORDER BY created_at DESC'
                )
            
            proxies = []
            for row in self.cursor.fetchall():
                proxies.append(dict(row))
            return proxies
        except sqlite3.Error as e:
            mk_logger.log_warn(f"Failed to get all proxies: {e}")
            return []
    
    def update_proxy(self, proxy_id: int, **kwargs) -> bool:
        """Update proxy configuration"""
        try:
            set_clause = []
            values = []
            
            for key, value in kwargs.items():
                set_clause.append(f"{key} = ?")
                values.append(value)
            
            if set_clause:
                set_clause.append("updated_at = ?")
                values.append(datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
                
                query = f"UPDATE pull_proxies SET {', '.join(set_clause)} WHERE id = ?"
                values.append(proxy_id)
                self.cursor.execute(query, values)
                self.connection.commit()
                return True
            return False
        except sqlite3.Error as e:
            mk_logger.log_warn(f"Failed to update proxy: {e}")
            return False
    
    def delete_proxy(self, proxy_id: int) -> bool:
        """Delete proxy configuration"""
        try:
            self.cursor.execute('DELETE FROM pull_proxies WHERE id = ?', (proxy_id,))
            self.connection.commit()
            return True
        except sqlite3.Error as e:
            mk_logger.log_warn(f"Failed to delete proxy: {e}")
            return False
    
    def add_recording(self, info: dict) -> Optional[int]:
        """写入一条 on_record_mp4 录像记录，file_path 相同则忽略"""
        try:
            self.cursor.execute(
                '''INSERT OR IGNORE INTO recordings
                   (vhost, app, stream, file_name, file_path, file_size, url, start_time, time_len)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                (
                    info.get("vhost", "__defaultVhost__"),
                    info.get("app", ""),
                    info.get("stream", ""),
                    info.get("file_name", ""),
                    info.get("file_path", ""),
                    int(info.get("file_size", 0) or 0),
                    info.get("url", ""),
                    int(info.get("start_time", 0) or 0),
                    float(info.get("time_len", 0.0) or 0.0),
                ),
            )
            self.connection.commit()
            return self.cursor.lastrowid
        except Exception as e:
            mk_logger.log_warn(f"add_recording error: {e}")
            return None

    def get_recordings(self, app: str = "", stream: str = "", vhost: str = "",
                       date: str = "", limit: int = 500, offset: int = 0) -> List[Dict[str, Any]]:
        """查询录像列表，支持按 app/stream/vhost/日期过滤"""
        try:
            clauses, params = [], []
            if vhost:
                clauses.append("vhost = ?"); params.append(vhost)
            if app:
                clauses.append("app = ?"); params.append(app)
            if stream:
                clauses.append("stream = ?"); params.append(stream)
            if date:
                # date 格式 YYYY-MM-DD，与 created_at 前10位匹配
                clauses.append("substr(created_at, 1, 10) = ?"); params.append(date)
            where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
            params += [limit, offset]
            self.cursor.execute(
                f"SELECT * FROM recordings {where} ORDER BY start_time DESC LIMIT ? OFFSET ?",
                params,
            )
            return [dict(r) for r in self.cursor.fetchall()]
        except Exception as e:
            mk_logger.log_warn(f"get_recordings error: {e}")
            return []

    def get_recording_streams(self) -> List[Dict[str, Any]]:
        """返回所有有录像的 vhost/app/stream 组合（去重）"""
        try:
            self.cursor.execute(
                "SELECT DISTINCT vhost, app, stream FROM recordings ORDER BY app, stream"
            )
            return [dict(r) for r in self.cursor.fetchall()]
        except Exception as e:
            mk_logger.log_warn(f"get_recording_streams error: {e}")
            return []

    def delete_recording(self, recording_id: int) -> bool:
        """删除一条录像记录"""
        try:
            self.cursor.execute("DELETE FROM recordings WHERE id = ?", (recording_id,))
            self.connection.commit()
            return True
        except Exception as e:
            mk_logger.log_warn(f"delete_recording error: {e}")
            return False

    def get_recording(self, app: str, stream: str, file_path: str) -> Optional[Dict[str, Any]]:
        """按 file_path 查询单条录像"""
        try:
            self.cursor.execute(
                "SELECT * FROM recordings WHERE app = ? AND stream = ? AND file_path = ?",
                (app, stream, file_path),
            )
            row = self.cursor.fetchone()
            return dict(row) if row else None
        except Exception as e:
            mk_logger.log_warn(f"get_recording error: {e}")
            return None
    
    def add_protocol_option(self, name: str, **kwargs) -> Optional[int]:
        """Add a protocol option preset"""
        try:
            fields = ['name']
            values = [name]
            placeholders = ['?']
            
            for key, value in kwargs.items():
                if key in ['modify_stamp', 'enable_audio', 'add_mute_audio', 'auto_close', 
                          'continue_push_ms', 'paced_sender_ms', 'enable_hls', 'enable_hls_fmp4',
                          'enable_mp4', 'enable_rtsp', 'enable_rtmp', 'enable_ts', 'enable_fmp4',
                          'mp4_as_player', 'mp4_max_second', 'mp4_save_path', 'hls_save_path',
                          'hls_demand', 'rtsp_demand', 'rtmp_demand', 'ts_demand', 'fmp4_demand']:
                    fields.append(key)
                    values.append(value)
                    placeholders.append('?')
            
            query = f"INSERT INTO protocol_options ({', '.join(fields)}) VALUES ({', '.join(placeholders)})"
            self.cursor.execute(query, values)
            self.connection.commit()
            return self.cursor.lastrowid
        except sqlite3.IntegrityError as e:
            print(f"Failed to add protocol option: {e}")
            return None
    
    def get_protocol_option(self, option_id: int) -> Optional[Dict[str, Any]]:
        """Get protocol option by ID"""
        try:
            self.cursor.execute('SELECT * FROM protocol_options WHERE id = ?', (option_id,))
            row = self.cursor.fetchone()
            if row:
                columns = [description[0] for description in self.cursor.description]
                return dict(zip(columns, row))
            return None
        except sqlite3.Error as e:
            print(f"Failed to get protocol option: {e}")
            return None
    
    def get_all_protocol_options(self) -> List[Dict[str, Any]]:
        """Get all protocol options (only basic info)"""
        try:
            self.cursor.execute('SELECT id, name, created_at FROM protocol_options ORDER BY created_at DESC')
            rows = self.cursor.fetchall()
            columns = [description[0] for description in self.cursor.description]
            return [dict(zip(columns, row)) for row in rows]
        except sqlite3.Error as e:
            print(f"Failed to get all protocol options: {e}")
            return []
    
    def update_protocol_option(self, option_id: int, **kwargs) -> bool:
        """Update protocol option"""
        try:
            set_clause = []
            values = []
            
            for key, value in kwargs.items():
                if key in ['name', 'modify_stamp', 'enable_audio', 'add_mute_audio', 'auto_close',
                          'continue_push_ms', 'paced_sender_ms', 'enable_hls', 'enable_hls_fmp4',
                          'enable_mp4', 'enable_rtsp', 'enable_rtmp', 'enable_ts', 'enable_fmp4',
                          'mp4_as_player', 'mp4_max_second', 'mp4_save_path', 'hls_save_path',
                          'hls_demand', 'rtsp_demand', 'rtmp_demand', 'ts_demand', 'fmp4_demand']:
                    set_clause.append(f"{key} = ?")
                    values.append(value)
            
            if set_clause:
                set_clause.append("updated_at = ?")
                values.append(datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
                values.append(option_id)
                
                query = f"UPDATE protocol_options SET {', '.join(set_clause)} WHERE id = ?"
                self.cursor.execute(query, values)
                self.connection.commit()
                return True
            return False
        except sqlite3.Error as e:
            print(f"Failed to update protocol option: {e}")
            return False
    
    def delete_protocol_option(self, option_id: int) -> bool:
        """Delete protocol option"""
        try:
            self.cursor.execute('DELETE FROM protocol_options WHERE id = ?', (option_id,))
            self.connection.commit()
            return True
        except sqlite3.Error as e:
            print(f"Failed to delete protocol option: {e}")
            return False
    
    def add_pull_proxy(self, proxy_data: Dict[str, Any]) -> Optional[int]:
        """Add a pull proxy"""
        try:
            self.cursor.execute(
                'INSERT INTO pull_proxies (vhost, app, stream, remark, custom_params, protocol_params, on_demand) VALUES (?, ?, ?, ?, ?, ?, ?)',
                (proxy_data.get('vhost', '__defaultVhost__'),
                 proxy_data.get('app'),
                 proxy_data.get('stream'),
                 proxy_data.get('remark', ''),
                 proxy_data.get('custom_params', '{}'),
                 proxy_data.get('protocol_params', '{}'),
                 int(bool(proxy_data.get('on_demand', 0))))
            )
            self.connection.commit()
            return self.cursor.lastrowid
        except sqlite3.IntegrityError as e:
            mk_logger.log_warn(f"Failed to add pull proxy: {e}")
            return None
    
    def get_pull_proxy(self, proxy_id: int) -> Optional[Dict[str, Any]]:
        """Get pull proxy by ID"""
        try:
            self.cursor.execute('SELECT * FROM pull_proxies WHERE id = ?', (proxy_id,))
            row = self.cursor.fetchone()
            if row:
                columns = [description[0] for description in self.cursor.description]
                return dict(zip(columns, row))
            return None
        except sqlite3.Error as e:
            print(f"Failed to get pull proxy: {e}")
            return None
    
    def get_all_pull_proxies(self) -> List[Dict[str, Any]]:
        """Get all pull proxies"""
        try:
            self.cursor.execute('SELECT * FROM pull_proxies ORDER BY created_at DESC')
            rows = self.cursor.fetchall()
            columns = [description[0] for description in self.cursor.description]
            return [dict(zip(columns, row)) for row in rows]
        except sqlite3.Error as e:
            print(f"Failed to get all pull proxies: {e}")
            return []
    
    def update_pull_proxy(self, proxy_id: int, **kwargs) -> bool:
        """Update pull proxy"""
        try:
            set_clause = []
            values = []
            
            for key, value in kwargs.items():
                if key in ['vhost', 'app', 'stream', 'remark', 'custom_params', 'protocol_params', 'on_demand']:
                    set_clause.append(f"{key} = ?")
                    values.append(value)
            
            if set_clause:
                set_clause.append("updated_at = ?")
                values.append(datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
                values.append(proxy_id)
                
                query = f"UPDATE pull_proxies SET {', '.join(set_clause)} WHERE id = ?"
                self.cursor.execute(query, values)
                self.connection.commit()
                return True
            return False
        except sqlite3.Error as e:
            print(f"Failed to update pull proxy: {e}")
            return False
    
    def delete_pull_proxy(self, vhost: str, app: str, stream: str) -> bool:
        """Delete pull proxy by vhost, app, stream"""
        try:
            self.cursor.execute('DELETE FROM pull_proxies WHERE vhost = ? AND app = ? AND stream = ?', 
                              (vhost, app, stream))
            self.connection.commit()
            return True
        except sqlite3.Error as e:
            print(f"Failed to delete pull proxy: {e}")
            return False

    # ==================== 多地址管理 ====================

    def get_proxy_urls(self, proxy_id: int) -> List[Dict[str, Any]]:
        """获取某个代理的所有地址，按 priority 升序，params 字段自动反序列化为 dict"""
        try:
            self.cursor.execute(
                'SELECT * FROM pull_proxy_urls WHERE proxy_id = ? ORDER BY priority ASC, id ASC',
                (proxy_id,)
            )
            rows = self.cursor.fetchall()
            columns = [d[0] for d in self.cursor.description]
            result = []
            for row in rows:
                item = dict(zip(columns, row))
                try:
                    item['params'] = json.loads(item.get('params') or '{}')
                except Exception:
                    item['params'] = {}
                result.append(item)
            return result
        except sqlite3.Error as e:
            mk_logger.log_warn(f"Failed to get proxy urls: {e}")
            return []

    def set_proxy_urls(self, proxy_id: int, urls: List[Dict[str, Any]]) -> bool:
        """
        全量替换某个代理的地址列表。
        urls 格式: [{"url": "...", "params": {"schema": "hls", "rtp_type": "0", ...}}, ...]
        """
        try:
            self.cursor.execute('DELETE FROM pull_proxy_urls WHERE proxy_id = ?', (proxy_id,))
            for i, item in enumerate(urls):
                params = item.get('params', {})
                if not isinstance(params, dict):
                    params = {}
                self.cursor.execute(
                    'INSERT INTO pull_proxy_urls (proxy_id, url, params, priority) VALUES (?, ?, ?, ?)',
                    (proxy_id, item.get('url', ''), json.dumps(params, ensure_ascii=False), i)
                )
            self.connection.commit()
            return True
        except sqlite3.Error as e:
            mk_logger.log_warn(f"Failed to set proxy urls: {e}")
            self.connection.rollback()
            return False

    def get_pull_proxy_with_urls(self, proxy_id: int) -> Optional[Dict[str, Any]]:
        """获取代理详情，同时附带 urls 列表"""
        proxy = self.get_pull_proxy(proxy_id)
        if proxy:
            proxy['urls'] = self.get_proxy_urls(proxy_id)
        return proxy

    def get_all_pull_proxies_with_urls(self) -> List[Dict[str, Any]]:
        """获取所有代理，每条附带 urls 列表"""
        proxies = self.get_all_pull_proxies()
        for proxy in proxies:
            proxy['urls'] = self.get_proxy_urls(proxy['id'])
        return proxies

    # ══════════════════════════════════════════════════════════════
    # 插件事件绑定 CRUD
    # ══════════════════════════════════════════════════════════════

    def get_all_plugin_bindings(self) -> List[Dict[str, Any]]:
        """
        获取所有事件绑定记录（新表 plugin_bindings）。
        返回格式：
        [
          {
            "event_type": "on_publish",
            "bindings": [
              {"id": 1, "plugin_name": "my_plugin", "params": {...}, "priority": 0, "enabled": 1},
              ...
            ]
          },
          ...
        ]
        按 event_type 分组，每组内按 priority ASC 排序。
        """
        try:
            self.cursor.execute(
                'SELECT * FROM plugin_bindings ORDER BY event_type, priority ASC, id ASC'
            )
            rows = self.cursor.fetchall()
            from collections import OrderedDict
            groups: OrderedDict = OrderedDict()
            for row in rows:
                d = dict(row)
                try:
                    d['params'] = json.loads(d.get('params') or '{}')
                except Exception:
                    d['params'] = {}
                et = d['event_type']
                if et not in groups:
                    groups[et] = []
                groups[et].append(d)
            return [{"event_type": et, "bindings": binds} for et, binds in groups.items()]
        except sqlite3.Error as e:
            mk_logger.log_warn(f"get_all_plugin_bindings error: {e}")
            return []

    def get_plugin_bindings_for_event(self, event_type: str) -> List[Dict[str, Any]]:
        """
        获取某个事件类型的所有绑定（新表），按 priority ASC 排序。
        返回 [{"id":..., "plugin_name":..., "params":{...}, "priority":..., "enabled":...}, ...]
        """
        try:
            self.cursor.execute(
                'SELECT * FROM plugin_bindings WHERE event_type=? ORDER BY priority ASC, id ASC',
                (event_type,)
            )
            result = []
            for row in self.cursor.fetchall():
                d = dict(row)
                try:
                    d['params'] = json.loads(d.get('params') or '{}')
                except Exception:
                    d['params'] = {}
                result.append(d)
            return result
        except sqlite3.Error as e:
            mk_logger.log_warn(f"get_plugin_bindings_for_event error: {e}")
            return []

    def upsert_plugin_binding_item(
        self, event_type: str, plugin_name: str,
        params: Optional[dict] = None, priority: int = 0, enabled: int = 1
    ) -> bool:
        """
        插入或更新单条绑定（event_type + plugin_name 唯一）。
        params 为字典，存储该绑定的自定义参数。
        """
        try:
            params_json = json.dumps(params or {}, ensure_ascii=False)
            self.cursor.execute(
                '''
                INSERT INTO plugin_bindings (event_type, plugin_name, params, priority, enabled, updated_at)
                VALUES (?, ?, ?, ?, ?, current_timestamp)
                ON CONFLICT(event_type, plugin_name) DO UPDATE SET
                    params     = excluded.params,
                    priority   = excluded.priority,
                    enabled    = excluded.enabled,
                    updated_at = current_timestamp
                ''',
                (event_type, plugin_name, params_json, priority, enabled),
            )
            self.connection.commit()
            return True
        except sqlite3.Error as e:
            mk_logger.log_warn(f"upsert_plugin_binding_item error: {e}")
            self.connection.rollback()
            return False

    def delete_plugin_binding_item(self, event_type: str, plugin_name: str) -> bool:
        """删除单条事件-插件绑定"""
        try:
            self.cursor.execute(
                'DELETE FROM plugin_bindings WHERE event_type=? AND plugin_name=?',
                (event_type, plugin_name)
            )
            self.connection.commit()
            return True
        except sqlite3.Error as e:
            mk_logger.log_warn(f"delete_plugin_binding_item error: {e}")
            return False

    def delete_plugin_bindings_for_event(self, event_type: str) -> bool:
        """删除某个事件类型下的所有绑定"""
        try:
            self.cursor.execute(
                'DELETE FROM plugin_bindings WHERE event_type=?',
                (event_type,)
            )
            self.connection.commit()
            return True
        except sqlite3.Error as e:
            mk_logger.log_warn(f"delete_plugin_bindings_for_event error: {e}")
            return False

    def save_plugin_bindings_for_event(
        self, event_type: str,
        bindings: List[Dict[str, Any]],
        enabled: int = 1
    ) -> bool:
        """
        全量保存某个事件类型的绑定列表（先删后插）。
        bindings 格式：[{"plugin_name": ..., "params": {...}}, ...]
        列表顺序即为执行优先级（index=priority）。
        enabled 控制整组绑定的启用状态。
        """
        try:
            self.cursor.execute(
                'DELETE FROM plugin_bindings WHERE event_type=?', (event_type,)
            )
            for idx, item in enumerate(bindings):
                plugin_name = item.get('plugin_name') or item.get('name', '')
                params = item.get('params') or {}
                params_json = json.dumps(params, ensure_ascii=False)
                self.cursor.execute(
                    '''
                    INSERT INTO plugin_bindings (event_type, plugin_name, params, priority, enabled, updated_at)
                    VALUES (?, ?, ?, ?, ?, current_timestamp)
                    ''',
                    (event_type, plugin_name, params_json, idx, enabled),
                )
            self.connection.commit()
            return True
        except sqlite3.Error as e:
            mk_logger.log_warn(f"save_plugin_bindings_for_event error: {e}")
            self.connection.rollback()
            return False


