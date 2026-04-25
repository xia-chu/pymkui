"""
拉流代理内置插件
包含两个默认启用的插件：
  - pull_proxy_on_demand   : 处理 on_stream_not_found，实现按需拉流
  - pull_proxy_failover    : 处理 on_player_proxy_failed，实现多地址故障转移
两个插件在数据库初始化时会自动插入默认绑定记录（INSERT OR IGNORE）。
"""

import mk_loader
import mk_logger
from py_plugin import PluginBase


class PullProxyOnDemand(PluginBase):
    """
    按需拉流插件（on_stream_not_found）
    当播放器请求的流不存在时，查询数据库中匹配的 on_demand=1 代理，
    触发拉流并让 ZLM 等待流上线后再推送给播放器。
    """
    name = "pull_proxy_on_demand"
    version = "1.0.0"
    description = "按需拉流插件，流不存在时自动触发拉流代理（on_demand=1）。默认启用，不建议禁用。"
    type = "on_stream_not_found"
    interruptible = True

    def run(self, **kwargs) -> bool:
        from py_http_api import db
        import mk_plugin as _mk

        args = kwargs.get("args", {})
        vhost  = args.get("vhost")  or "__defaultVhost__"
        app    = args.get("app",    "")
        stream = args.get("stream", "")

        try:
            db.cursor.execute(
                "SELECT * FROM pull_proxies WHERE vhost=? AND app=? AND stream=? AND on_demand=1",
                (vhost, app, stream)
            )
            row = db.cursor.fetchone()
            proxy = dict(row) if row else None
        except Exception as e:
            mk_logger.log_warn(f"[pull_proxy_on_demand] 查询数据库失败: {e}")
            proxy = None

        if not proxy:
            return False

        pid = proxy.get("id")
        proxy_urls = db.get_proxy_urls(pid)
        first_url  = proxy_urls[0] if proxy_urls else {}
        url        = first_url.get("url", "")
        url_params = first_url.get("params", {})

        if not url:
            mk_logger.log_warn(f"[pull_proxy_on_demand] 按需代理无有效地址 id={pid}")
            return False

        vhost, app, stream, url, retry_count, timeout_sec, opt = _mk._build_proxy_call_args(
            proxy, url, url_params
        )
        mk_logger.log_info(
            f"[pull_proxy_on_demand] 触发按需拉流 id={pid} {vhost}/{app}/{stream} url={url}"
        )

        def cb(err, key):
            if err:
                mk_logger.log_warn(
                    f"[pull_proxy_on_demand] 按需拉流失败 id={pid} {vhost}/{app}/{stream}: {err}"
                )
            else:
                mk_logger.log_info(
                    f"[pull_proxy_on_demand] 按需拉流成功 id={pid} {vhost}/{app}/{stream}"
                )

        opt['auto_close'] = True
        mk_loader.add_stream_proxy(
            vhost, app, stream, url, cb,
            retry_count=len(proxy_urls) - 1,
            force=True,
            timeout_sec=timeout_sec,
            opt=opt,
        )
        return True


class PullProxyFailover(PluginBase):
    """
    多地址故障转移插件（on_player_proxy_failed）
    当拉流代理失败时，自动切换到下一个备用地址（循环）。
    """
    name = "pull_proxy_failover"
    version = "1.0.0"
    description = "拉流代理多地址故障转移插件，拉流失败时自动切换备用地址。默认启用，不建议禁用。"
    type = "on_player_proxy_failed"
    interruptible = True

    def run(self, **kwargs) -> bool:
        from py_http_api import db

        url         = kwargs.get("url", "")
        media_tuple = kwargs.get("media_tuple")

        try:
            vhost  = media_tuple.vhost  if hasattr(media_tuple, 'vhost')  else '__defaultVhost__'
            app    = media_tuple.app    if hasattr(media_tuple, 'app')    else ''
            stream = media_tuple.stream if hasattr(media_tuple, 'stream') else ''

            if not app or not stream:
                return False

            db.cursor.execute(
                "SELECT * FROM pull_proxies WHERE vhost=? AND app=? AND stream=?",
                (vhost, app, stream)
            )
            row = db.cursor.fetchone()
            if not row:
                return False

            proxy = dict(row)
            pid   = proxy.get("id")
            if not pid:
                return False

            proxy_urls = db.get_proxy_urls(int(pid))
            if len(proxy_urls) <= 1:
                return False

            current_idx = next(
                (i for i, pu in enumerate(proxy_urls) if pu.get("url", "") == url),
                0
            )
            next_idx = (current_idx + 1) % len(proxy_urls)
            if next_idx == current_idx:
                return False

            next_url_item = proxy_urls[next_idx]
            next_url      = next_url_item.get("url", "")
            next_params   = next_url_item.get("params", {})

            if not next_url:
                return False

            mk_logger.log_info(
                f"[pull_proxy_failover] 切换备用地址 id={pid} {vhost}/{app}/{stream} "
                f"[{current_idx}→{next_idx}] {url} → {next_url}"
            )
            mk_loader.update_stream_proxy(vhost, app, stream, next_url, next_params)
            return True

        except Exception as e:
            mk_logger.log_warn(f"[pull_proxy_failover] 多地址切换异常: {e}")

        return False


class PullProxyRestore(PluginBase):
    """
    启动恢复插件（on_start）
    ZLMediaKit 启动时，从数据库读取所有 on_demand=0 的拉流代理，
    调用 mk_loader.add_stream_proxy 重新注册，恢复上次运行状态。
    非独占，允许其他 on_start 插件同时运行。
    """
    name = "pull_proxy_restore"
    version = "1.0.0"
    description = "启动时自动恢复非按需拉流代理。默认启用，不建议禁用。"
    type = "on_start"
    interruptible = False

    def run(self, **kwargs) -> bool:
        import mk_plugin as _mk
        from py_http_api import db

        try:
            proxies = db.get_all_pull_proxies()
        except Exception as e:
            mk_logger.log_warn(f"[pull_proxy_restore] 读取数据库失败: {e}")
            return False

        count = 0
        for proxy in proxies:
            if proxy.get("on_demand", 0):
                continue

            proxy_id = proxy.get("id")
            vhost  = proxy.get("vhost")  or "__defaultVhost__"
            app    = proxy.get("app",    "")
            stream = proxy.get("stream", "")

            proxy_urls = db.get_proxy_urls(proxy_id)
            first_url  = proxy_urls[0] if proxy_urls else {}
            url        = first_url.get("url", "")
            url_params = first_url.get("params", {})

            if not app or not stream or not url:
                mk_logger.log_warn(f"[pull_proxy_restore] 跳过无效记录 id={proxy_id}")
                continue

            vhost, app, stream, url, retry_count, timeout_sec, opt = _mk._build_proxy_call_args(
                proxy, url, url_params
            )

            def make_cb(pid, v, a, s, u):
                def cb(err, key):
                    if err:
                        mk_logger.log_warn(
                            f"[pull_proxy_restore] 恢复失败 id={pid} {v}/{a}/{s}: {err}"
                        )
                    else:
                        mk_logger.log_info(
                            f"[pull_proxy_restore] 恢复成功 id={pid} {v}/{a}/{s} url={u}"
                        )
                return cb

            mk_logger.log_info(
                f"[pull_proxy_restore] 恢复拉流代理 id={proxy_id} {vhost}/{app}/{stream} url={url} "
                f"retry_count={retry_count} timeout_sec={timeout_sec}"
            )
            mk_loader.add_stream_proxy(
                vhost, app, stream, url,
                make_cb(proxy_id, vhost, app, stream, url),
                retry_count=retry_count,
                force=True,
                timeout_sec=timeout_sec,
                opt=opt,
            )
            count += 1

        mk_logger.log_info(f"[pull_proxy_restore] 共恢复 {count} 个拉流代理")
        return False  # 非独占，始终返回 False 让其他 on_start 插件继续执行
