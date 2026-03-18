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
        
        self._create_tables()
    
    def _create_tables(self):
        """Create necessary tables"""
        self.cursor.execute('''
            CREATE TABLE IF NOT EXISTS pull_proxies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                vhost TEXT NOT NULL DEFAULT '__defaultVhost__',
                app TEXT NOT NULL,
                stream TEXT NOT NULL,
                url TEXT NOT NULL,
                remark TEXT DEFAULT '',
                custom_params TEXT,
                protocol_params TEXT,
                on_demand INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT current_timestamp,
                updated_at TIMESTAMP DEFAULT current_timestamp,
                UNIQUE(vhost, app, stream)
            )
        ''')
        # 兼容已有数据库：若旧表缺少列则补上
        for col_def in [
            'ALTER TABLE pull_proxies ADD COLUMN on_demand INTEGER DEFAULT 0',
            "ALTER TABLE pull_proxies ADD COLUMN remark TEXT DEFAULT ''",
        ]:
            try:
                self.cursor.execute(col_def)
                self.connection.commit()
            except Exception:
                pass  # 列已存在，忽略
        
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
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app TEXT NOT NULL,
                stream TEXT not NULL,
                url TEXT NOT NULL,
                file_path TEXT,
                file_size INTEGER,
                created_at TIMESTAMP DEFAULT current_TIMESTAMP
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
        
        self.connection.commit()
        mk_logger.log_info(f"Database initialized at {self.db_path}")
    
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
    
    def add_recording(self, app: str, stream: str, url: str, file_path: Optional[str] = None, file_size: Optional[int] = None) -> Optional[Dict[str, Any]]:
        """Add a recording"""
        try:
            self.cursor.execute(
                'INSERT INTO recordings (app, stream, url, file_path, file_size, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                (app, stream, url, file_path, file_size, datetime.now())
            )
            self.connection.commit()
        except sqlite3.IntegrityError as e:
            mk_logger.log_warn(f"Failed to add recording: {e}")
    
    def get_recordings(self, app: str, stream: str, limit: int = 100) -> List[Dict[str, Any]]:
        """Get recordings for a specific stream"""
        try:
            self.cursor.execute(
                'SELECT * FROM recordings WHERE app = ? AND stream = ? ORDER BY created_at DESC LIMIT ?',
                (app, stream, limit)
            )
            recordings = []
            for row in self.cursor.fetchall():
                recordings.append({
                    'id': row[0],
                    'app': row[1],
                    'stream': row[2],
                    'url': row[3],
                    'file_path': row[4],
                    'file_size': row[5],
                    'created_at': row[6]
                })
            return recordings
        except sqlite3.Error as e:
            print(f"Failed to get recordings: {e}")
            return []
    
    def get_recording(self, app: str, stream: str, file_path: str) -> Optional[Dict[str, Any]]:
        """Get a specific recording"""
        try:
            self.cursor.execute(
                'SELECT * FROM recordings WHERE app = ? AND stream = ? AND file_path = ?',
                (app, stream, file_path)
            )
            row = self.cursor.fetchone()
            if row:
                return {
                    'id': row[0],
                    'app': row[1],
                    'stream': row[2],
                    'url': row[3],
                    'file_path': row[4],
                    'file_size': row[5],
                    'created_at': row[6]
                }
            return None
        except sqlite3.Error as e:
            print(f"Failed to get recording: {e}")
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
                'INSERT INTO pull_proxies (vhost, app, stream, url, remark, custom_params, protocol_params, on_demand) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                (proxy_data.get('vhost', '__defaultVhost__'),
                 proxy_data.get('app'),
                 proxy_data.get('stream'),
                 proxy_data.get('url'),
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
                if key in ['vhost', 'app', 'stream', 'url', 'remark', 'custom_params', 'protocol_params', 'on_demand']:
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