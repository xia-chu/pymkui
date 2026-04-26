"""
Token 鉴权插件（播放 + 推流）
- PlayTokenAuth  : 处理 on_play，播放前校验 token
- PublishTokenAuth: 处理 on_publish，推流前校验 token

两个插件共享 TokenAuthBase 基类，所有 token 生成/校验/过期逻辑在基类中实现。
"""

import time
import secrets
import string
import fnmatch

import mk_loader
import mk_logger
from py_plugin import PluginBase
from urllib.parse import parse_qs


# ── 公共基类 ─────────────────────────────────────────────────────────────────

class TokenAuthBase(PluginBase):
    """
    Token 鉴权基类。
    子类只需声明 name/description/type，以及实现 _allow(invoker) / _deny(invoker) 两个方法。
    鉴权插件会调用 invoker（publish_auth_invoker_do / play_auth_invoker_do），
    消费事件后不允许其他插件继续处理，因此 interruptible=True。
    """
    abstract = True   # 中间基类，不注册为实际插件
    interruptible = True  # 鉴权插件：消费后终止后续插件
    _token: dict = {}

    # ── 参数 schema ──────────────────────────────────────────────────────────
    def params(self) -> dict:
        return {
            "vhost_filter": {
                "type": "str",
                "description": "vhost 过滤规则，支持通配符 *，默认 * 匹配所有",
                "default": "*",
            },
            "app_filter": {
                "type": "str",
                "description": "app 过滤规则，支持通配符 *，默认 * 匹配所有",
                "default": "*",
            },
            "stream_filter": {
                "type": "str",
                "description": "stream 过滤规则，支持通配符 *，默认 * 匹配所有，例如 test* 匹配所有 test 开头的流",
                "default": "*",
            },
            "expire_seconds": {
                "type": "int",
                "description": "token 过期时间（秒），默认 300 秒",
                "default": 300,
            },
            "token_length": {
                "type": "int",
                "description": "token 随机字符串长度，默认 16",
                "default": 16,
            },
            "token_usage_count": {
                "type": "int",
                "description": "token 最大使用次数，-1 表示不限，默认 -1",
                "default": -1,
            },
            "allow_localhost": {
                "type": "bool",
                "description": "是否允许 localhost 访问忽略鉴权，默认 true",
                "default": True,
            },
        }

    # ── 子类需要实现的钩子 ────────────────────────────────────────────────────
    def _allow(self, invoker, extra: dict | None = None):
        raise NotImplementedError

    def _deny(self, invoker, reason: str = "token error"):
        raise NotImplementedError

    # ── 核心逻辑 ──────────────────────────────────────────────────────────────
    def run(self, **kwargs) -> bool:
        args           = kwargs.get("args", {})
        invoker        = kwargs.get("invoker")
        binding_params = kwargs.get("binding_params", {})

        vhost  = args.get("vhost", "__defaultVhost__")
        app    = args.get("app", "")
        stream = args.get("stream", "")
        # 从sender获取客户端IP，支持IPv6
        client_ip = ""
        sender = kwargs.get("sender")
        if isinstance(sender, dict) and "peer_ip" in sender:
            client_ip = sender.get("peer_ip", "")

        # 通配符过滤：不命中则跳过，不消费事件
        vhost_filter  = binding_params.get("vhost_filter",  "*") or "*"
        app_filter    = binding_params.get("app_filter",    "*") or "*"
        stream_filter = binding_params.get("stream_filter", "*") or "*"
        if not (fnmatch.fnmatch(vhost, vhost_filter)
                and fnmatch.fnmatch(app, app_filter)
                and fnmatch.fnmatch(stream, stream_filter)):
            mk_logger.log_info(
                f"[{self.name}] skip {vhost}/{app}/{stream} "
                f"(filter: {vhost_filter}/{app_filter}/{stream_filter})"
            )
            return False

        # 检查是否是 localhost 访问
        allow_localhost = binding_params.get("allow_localhost", True)
        if isinstance(allow_localhost, str):
            allow_localhost = allow_localhost.lower() not in ('false', '0', '')
        if allow_localhost and client_ip in ('127.0.0.1', '::1', 'localhost'):
            mk_logger.log_info(f"[{self.name}] allow localhost access {vhost}/{app}/{stream}")
            self._allow(invoker, extra=binding_params)
            return True

        expire_seconds    = int(binding_params.get("expire_seconds", 300))
        token_length      = int(binding_params.get("token_length", 16))
        token_usage_count = int(binding_params.get("token_usage_count", -1))

        vhost  = args.get("vhost", "__defaultVhost__")
        app    = args.get("app", "")
        stream = args.get("stream", "")

        expected = self.get_token(vhost, app, stream,
                                  expire_seconds=expire_seconds,
                                  token_length=token_length,
                                  token_usage_count=token_usage_count)
        given = parse_qs(args.get("params", "")).get("token", [""])[0]

        if given != expected:
            mk_logger.log_info(f"[{self.name}] token mismatch {vhost}/{app}/{stream}")
            self._deny(invoker)
        else:
            if token_usage_count > 0:
                self._decr_usage(vhost, app, stream)
            # 将 binding_params 透传给 _allow，供子类按需使用（如 PublishTokenAuth 的协议配置）
            self._allow(invoker, extra=binding_params)
        return True

    def get_url_params(self, **kwargs) -> dict:
        vhost  = kwargs.get("vhost", "__defaultVhost__")
        app    = kwargs.get("app", "")
        stream = kwargs.get("stream", "")
        binding_params    = kwargs.get("binding_params", {})

        # 不在过滤范围内则不追加 token 参数
        vhost_filter  = binding_params.get("vhost_filter",  "*") or "*"
        app_filter    = binding_params.get("app_filter",    "*") or "*"
        stream_filter = binding_params.get("stream_filter", "*") or "*"
        if not (fnmatch.fnmatch(vhost, vhost_filter)
                and fnmatch.fnmatch(app, app_filter)
                and fnmatch.fnmatch(stream, stream_filter)):
            return {}

        expire_seconds    = int(binding_params.get("expire_seconds", 300))
        token_length      = int(binding_params.get("token_length", 16))
        token_usage_count = int(binding_params.get("token_usage_count", -1))
        token = self.get_token(vhost, app, stream,
                               expire_seconds=expire_seconds,
                               token_length=token_length,
                               token_usage_count=token_usage_count)
        return {"token": token}

    # ── Token 管理 ────────────────────────────────────────────────────────────
    @staticmethod
    def _random_string(length: int = 16) -> str:
        chars = string.ascii_letters + string.digits
        return ''.join(secrets.choice(chars) for _ in range(length))

    def get_token(self, vhost, app, stream,
                  expire_seconds=300, token_length=16, token_usage_count=-1) -> str:
        key  = (vhost, app, stream)
        item = self._token.get(key)
        need_new = (
            not item
            or time.time() > item[1] + expire_seconds
            or (token_usage_count > 0 and item[2] <= 0)
        )
        if need_new:
            return self._new_token(key, token_length, token_usage_count)
        return item[0]

    def _new_token(self, key: tuple, token_length: int, token_usage_count: int) -> str:
        token = self._random_string(token_length)
        self._token[key] = (token, time.time(), token_usage_count)
        return token

    def _decr_usage(self, vhost, app, stream):
        key  = (vhost, app, stream)
        item = self._token.get(key)
        if item and item[2] > 0:
            self._token[key] = (item[0], item[1], item[2] - 1)

    def cleanup(self, expire_seconds: int = 300):
        now     = time.time()
        expired = [k for k, (_, ts, _u) in self._token.items() if now > ts + expire_seconds]
        for k in expired:
            del self._token[k]


# ── 播放鉴权 ──────────────────────────────────────────────────────────────────

class PlayTokenAuth(TokenAuthBase):
    name        = "play_token_auth"
    version     = "1.0.0"
    description = "播放鉴权插件，鉴权失败后会拒绝播放请求。支持 vhost/app/stream 通配符过滤，可多次绑定针对不同流。"
    type        = "on_play"
    interruptible = True
    multi_binding = True
    abstract    = False

    _token: dict = {}   # 与 PublishTokenAuth 各自独立

    def _allow(self, invoker, extra: dict | None = None):
        mk_loader.play_auth_invoker_do(invoker, "")

    def _deny(self, invoker, reason: str = "token error"):
        mk_loader.play_auth_invoker_do(invoker, reason)


# ── 推流鉴权 ──────────────────────────────────────────────────────────────────

class PublishTokenAuth(TokenAuthBase):
    name        = "publish_token_auth"
    version     = "1.0.0"
    description = "推流鉴权插件，鉴权失败后会拒绝推流请求。支持 vhost/app/stream 通配符过滤，可多次绑定针对不同流。可配置协议选项，鉴权通过后自动应用。"
    type        = "on_publish"
    interruptible = True
    multi_binding = True
    abstract    = False

    _token: dict = {}   # 与 PlayTokenAuth 各自独立

    def params(self) -> dict:
        # 继承基类 token 参数，并追加鉴权开关和协议配置选择参数
        base = super().params()
        base["enable_auth"] = {
            "type": "bool",
            "description": "是否启用 token 鉴权，关闭后仅应用协议配置，不校验 token",
            "default": True,
        }
        base["protocol_option"] = {
            "type": "protocol_option",
            "description": "推流鉴权通过（或鉴权关闭）后应用的协议配置（可选）",
            "default": {},
        }
        return base

    def run(self, **kwargs) -> bool:
        binding_params = kwargs.get("binding_params", {})
        enable_auth = binding_params.get("enable_auth", True)
        if isinstance(enable_auth, str):
            enable_auth = enable_auth.lower() not in ('false', '0', '')
        if not enable_auth:
            # 鉴权关闭：直接放行，仅应用协议配置
            invoker = kwargs.get("invoker")
            args    = kwargs.get("args", {})
            vhost   = args.get("vhost", "__defaultVhost__")
            app     = args.get("app", "")
            stream  = args.get("stream", "")
            mk_logger.log_info(f"[publish_token_auth] auth disabled, allow {vhost}/{app}/{stream}")
            self._allow(invoker, extra=binding_params)
            return True
        return super().run(**kwargs)

    def get_url_params(self, **kwargs) -> dict:
        binding_params = kwargs.get("binding_params", {})
        enable_auth = binding_params.get("enable_auth", True)
        if isinstance(enable_auth, str):
            enable_auth = enable_auth.lower() not in ('false', '0', '')
        if not enable_auth:
            return {}
        return super().get_url_params(**kwargs)

    def _allow(self, invoker, extra: dict | None = None):
        # 从 binding_params 中取出 protocol_option，直接传入（数据库保存时已只存协议字段）
        protocol_opt: dict = {}
        if extra:
            raw = extra.get("protocol_option")
            if isinstance(raw, dict):
                protocol_opt = raw
        mk_logger.log_info(f"[publish_token_auth] allow, protocol_option={protocol_opt}")
        mk_loader.publish_auth_invoker_do(invoker, "", protocol_opt)

    def _deny(self, invoker, reason: str = "token error"):
        mk_loader.publish_auth_invoker_do(invoker, reason, {})
