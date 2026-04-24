import time
import secrets
import string

import mk_loader
import mk_logger
from py_plugin import PluginBase
from urllib.parse import parse_qs

class PluginOnPublish(PluginBase):
    name = "publish_token_auth"
    version = "1.0.0"
    description = "推流鉴权插件，鉴权失败后会拒绝推流请求。"
    type = "on_publish"

    _token = {}

    def run(self, **kwargs):
        args    = kwargs.get("args", {})
        sender  = kwargs.get("sender", "")
        invoker = kwargs.get("invoker", "")
        binding_params = kwargs.get("binding_params", {})
        mk_logger.log_info(f"on_publish args: {args}, sender: {sender}")

        expire_seconds    = int(binding_params.get("expire_seconds", 300))
        token_length      = int(binding_params.get("token_length", 16))
        token_usage_count = int(binding_params.get("token_usage_count", -1))

        vhost  = args.get("vhost", "__defaultVhost__")
        app    = args.get("app", "")
        stream = args.get("stream", "")

        token  = self.get_token(vhost, app, stream,
                                expire_seconds=expire_seconds,
                                token_length=token_length,
                                token_usage_count=token_usage_count)
        result = parse_qs(args.get("params", ""))
        if result.get("token", [""])[0] != token:
            mk_loader.publish_auth_invoker_do(invoker, "token error")
        else:
            if token_usage_count > 0:
                self._decr_usage(vhost, app, stream)
            mk_loader.publish_auth_invoker_do(invoker, "")
        return True

    def get_url_params(self, **kwargs) -> dict:
        vhost  = kwargs.get("vhost", "__defaultVhost__")
        app    = kwargs.get("app", "")
        stream = kwargs.get("stream", "")
        binding_params    = kwargs.get("binding_params", {})
        expire_seconds    = int(binding_params.get("expire_seconds", 300))
        token_length      = int(binding_params.get("token_length", 16))
        token_usage_count = int(binding_params.get("token_usage_count", -1))
        token = self.get_token(vhost, app, stream,
                               expire_seconds=expire_seconds,
                               token_length=token_length,
                               token_usage_count=token_usage_count)
        return {"token": token}

    def params(self) -> dict:
        return {
            "expire_seconds": {
                "type": "int",
                "description": "鉴权token过期时间（秒），默认300秒",
                "default": 300
            },
            "token_length": {
                "type": "int",
                "description": "鉴权token长度，默认16",
                "default": 16
            },
            "token_usage_count": {
                "type": "int",
                "description": "鉴权token使用次数，默认-1（不限制），超过后即失效",
                "default": -1
            }
        }

    @staticmethod
    def random_string(length=16):
        chars = string.ascii_letters + string.digits
        return ''.join(secrets.choice(chars) for _ in range(length))

    def get_token(self, vhost, app, stream,
                  expire_seconds=300, token_length=16, token_usage_count=-1):
        key  = (vhost, app, stream)
        item = self._token.get(key)
        if not item:
            return self.add_token(vhost, app, stream,
                                  expire_seconds=expire_seconds,
                                  token_length=token_length,
                                  token_usage_count=token_usage_count)[0]
        token, timestamp, usage_left = item
        if time.time() > timestamp + expire_seconds:
            return self.add_token(vhost, app, stream,
                                  expire_seconds=expire_seconds,
                                  token_length=token_length,
                                  token_usage_count=token_usage_count)[0]
        if token_usage_count > 0 and usage_left <= 0:
            return self.add_token(vhost, app, stream,
                                  expire_seconds=expire_seconds,
                                  token_length=token_length,
                                  token_usage_count=token_usage_count)[0]
        return token

    def add_token(self, vhost, app, stream,
                  expire_seconds=300, token_length=16, token_usage_count=-1):
        token = self.random_string(token_length)
        now   = time.time()
        self._token[(vhost, app, stream)] = (token, now, token_usage_count)
        return token, now

    def _decr_usage(self, vhost, app, stream):
        key  = (vhost, app, stream)
        item = self._token.get(key)
        if item:
            token, ts, usage_left = item
            if usage_left > 0:
                self._token[key] = (token, ts, usage_left - 1)

    def cleanup(self):
        now     = time.time()
        expired = []
        for k, (_, ts, _usage) in self._token.items():
            if now > ts + 300:
                expired.append(k)
        for k in expired:
            del self._token[k]
