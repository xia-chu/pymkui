import re
import time
import secrets
import string

import mk_loader
import mk_logger
from py_plugin import PluginBase
from urllib.parse import parse_qs, unquote

class PluginOnPlay(PluginBase):
    name = "on_play"
    version = "1.0.0"
    description = "播放鉴权插件，鉴权失败后会拒绝播放请求。"
    type = "on_play"

    _token = {}
    
    def run(self, **kwargs):
        args = kwargs.get("args", {})
        sender = kwargs.get("sender", "")
        invoker = kwargs.get("invoker", "")
        mk_logger.log_info(f"args: {args}, sender: {sender}")

        vhost = args.get("vhost", "__defaultVhost__")
        app = args.get("app", "")
        stream = args.get("stream", "")
        
        token = self.get_token(vhost, app, stream)
        result = parse_qs(args.get("params", ""))
        if result.get("token", [""])[0] != token:
            mk_loader.play_auth_invoker_do(invoker, "token error")
        else:
            mk_loader.play_auth_invoker_do(invoker, "")

    def before_run(self, **kwargs):
        vhost = kwargs.get("vhost", "__defaultVhost__")
        app = kwargs.get("app", "")
        stream = kwargs.get("stream", "")
        return self.get_token(vhost, app, stream)


    @staticmethod
    def random_string(length=16):
        chars = string.ascii_letters + string.digits
        return ''.join(secrets.choice(chars) for _ in range(length))
    
    def get_token(self, vhost, app, stream):
        key = (vhost, app, stream)
        item = self._token.get(key)
        if not item:
            token, now = self.add_token(vhost, app, stream)
            return token
        token, timestamp = item
        if time.time() > timestamp + 300:
            token, now = self.add_token(vhost, app, stream)
            return token
        return token

    def add_token(self, vhost, app, stream):
        token = self.random_string()
        now = time.time()
        self._token[(vhost, app, stream)] = (token, now)
        return token, now
    
    def cleanup(self):
        now = time.time()
        expired = []

        for k, (_, ts) in self._token.items():
            if now > ts + 300:
                expired.append(k)

        for k in expired:
            del self._token[k]
