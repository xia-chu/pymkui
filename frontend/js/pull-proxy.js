// ==================== 拉流代理页面 ====================

// 分页状态
const _pullProxyState = {
    all: [],       // 全量数据
    page: 1,       // 当前页（从 1 开始）
    pageSize: 10,  // 每页行数
};

// 状态缓存: key => ZLM listStreamProxy 返回的单条数据（或 null=离线）
const _pullProxyStatusCache = {};

function initPullProxyEvents() {
    const addButton = document.getElementById('addPullProxy');
    if (addButton) {
        const newBtn = addButton.cloneNode(true);
        addButton.parentNode.replaceChild(newBtn, addButton);
        newBtn.addEventListener('click', openAddPullProxyModal);
    }

    const refreshBtn = document.getElementById('refreshPullProxy');
    if (refreshBtn) {
        const newRefreshBtn = refreshBtn.cloneNode(true);
        refreshBtn.parentNode.replaceChild(newRefreshBtn, refreshBtn);
        newRefreshBtn.addEventListener('click', loadPullProxyList);
    }
}

async function loadPullProxyList() {
    initPullProxyEvents();

    const tbody = document.getElementById('pullProxyTableBody');
    if (!tbody) return;

    tbody.innerHTML = `
        <tr>
            <td colspan="10" class="p-10 text-center">
                <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto mb-4"></div>
                <span class="text-white/60 font-semibold">加载中...</span>
            </td>
        </tr>
    `;

    try {
        const result = await Api.getStreamProxyList();

        if (result.code === 0) {
            _pullProxyState.all = result.data || [];
            _pullProxyState.page = 1;

            // 批量查询 ZLM 状态（并发，忽略失败）
            await _fetchAllProxyStatus(_pullProxyState.all);

            _renderPullProxyPage();
        } else {
            tbody.innerHTML = `
                <tr>
                    <td colspan="10" class="p-10 text-center text-white/60 font-semibold">
                        加载失败: ${result.msg || '未知错误'}
                    </td>
                </tr>
            `;
        }
    } catch (error) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" class="p-10 text-center text-white/60 font-semibold">
                    网络错误: ${error.message}
                </td>
            </tr>
        `;
    }
}

/**
 * 批量并发查询所有代理在 ZLM 中的状态，结果写入 _pullProxyStatusCache
 */
async function _fetchAllProxyStatus(proxies) {
    await Promise.all(proxies.map(async proxy => {
        const vhost  = proxy.vhost  || '__defaultVhost__';
        const app    = proxy.app    || '';
        const stream = proxy.stream || '';
        const key    = `${vhost}/${app}/${stream}`;
        try {
            const res = await Api.listStreamProxy(key);
            if (res && res.code === 0 && Array.isArray(res.data) && res.data.length > 0) {
                _pullProxyStatusCache[key] = res.data[0];
            } else {
                _pullProxyStatusCache[key] = null;
            }
        } catch (e) {
            _pullProxyStatusCache[key] = null;
        }
    }));
}

function _renderPullProxyPage() {
    const tbody = document.getElementById('pullProxyTableBody');
    const pagination = document.getElementById('pullProxyPagination');
    const pageInfo = document.getElementById('pullProxyPageInfo');
    const pageBtns = document.getElementById('pullProxyPageBtns');
    const prevBtn = document.getElementById('pullProxyPrevBtn');
    const nextBtn = document.getElementById('pullProxyNextBtn');
    if (!tbody) return;

    const { all, page, pageSize } = _pullProxyState;
    const total = all.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const curPage = Math.min(page, totalPages);
    _pullProxyState.page = curPage;

    if (total === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" class="p-10 text-center text-white/60 font-semibold">
                    暂无拉流代理，点击「新增拉流代理」添加
                </td>
            </tr>
        `;
        if (pagination) pagination.classList.add('hidden');
        return;
    }

    const start = (curPage - 1) * pageSize;
    const pageData = all.slice(start, start + pageSize);

    let html = '';
    pageData.forEach(proxy => {
        const onDemand = proxy.on_demand ? 1 : 0;
        const onDemandClass = onDemand
            ? 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/40 cursor-pointer'
            : 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/40 cursor-pointer';
        const onDemandText = onDemand ? '按需' : '立即';
        const onDemandIcon = onDemand ? 'fa-clock-o' : 'fa-play-circle';
        const onDemandTitle = onDemand ? '当前按需模式，点击切换为立即拉流' : '当前立即模式，点击切换为按需拉流';
        const createdAt = proxy.created_at || '-';

        // ---- 状态列 ----
        const vhost  = proxy.vhost  || '__defaultVhost__';
        const key    = `${vhost}/${proxy.app}/${proxy.stream}`;
        const status = _pullProxyStatusCache[key]; // null=离线 / undefined=未查询 / object=ZLM数据
        let statusHtml = '';
        if (status === undefined) {
            // 未查询
            statusHtml = `<span class="px-3 py-1 rounded-full text-xs font-semibold bg-white/10 text-white/40">查询中</span>`;
        } else if (status === null) {
            // ZLM 无此记录 → 离线（不可点击）
            statusHtml = `<span class="px-3 py-1 rounded-full text-xs font-semibold bg-white/10 text-white/40"><i class="fa fa-circle mr-1"></i>离线</span>`;
        } else {
            const ss = status.status_str || '';
            // 把 status 对象存到全局 map，用 key 引用，避免 onclick 内联 JSON 转义问题
            _pullProxyStatusCache['__detail__' + key] = status;
            const escapedKey = key.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            if (ss === 'playing') {
                statusHtml = `<button class="px-3 py-1 rounded-full text-xs font-semibold bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors"
                    onclick="showProxyStatusDetail('${escapedKey}')">
                    <i class="fa fa-circle mr-1"></i>在线
                </button>`;
            } else {
                statusHtml = `<button class="px-3 py-1 rounded-full text-xs font-semibold bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                    onclick="showProxyStatusDetail('${escapedKey}')">
                    <i class="fa fa-exclamation-circle mr-1"></i>失败
                </button>`;
            }
        }

        html += `
            <tr class="border-b border-white/5 hover:bg-white/5 transition-colors">
                <td class="p-4 text-white/70 text-sm">${proxy.id}</td>
                <td class="p-4 text-white text-sm">${proxy.vhost || '__defaultVhost__'}</td>
                <td class="p-4 text-white font-semibold">${proxy.app || '-'}</td>
                <td class="p-4 text-white font-semibold">${proxy.stream || '-'}</td>
                <td class="p-4 text-white/80 text-sm whitespace-nowrap overflow-hidden text-ellipsis" style="max-width:220px" title="${proxy.url || ''}">${proxy.url || '-'}</td>
                <td class="p-4 text-white/60 text-sm whitespace-nowrap overflow-hidden text-ellipsis" style="max-width:160px" title="${proxy.remark || ''}">${proxy.remark || '-'}</td>
                <td class="p-4">
                    <button class="px-3 py-1 rounded-full text-sm font-semibold transition-colors ${onDemandClass}"
                        title="${onDemandTitle}"
                        onclick="togglePullProxyMode(${proxy.id}, ${onDemand})">
                        <i class="fa ${onDemandIcon} mr-1"></i>${onDemandText}
                    </button>
                </td>
                <td class="p-4">${statusHtml}</td>
                <td class="p-4 text-white/60 text-sm">${createdAt}</td>
                <td class="p-4 space-x-2">
                    <button class="bg-blue-500/80 text-white px-3 py-1 rounded-lg text-sm font-semibold hover:shadow-neon transition-colors"
                        onclick="viewPullProxyDetail(${proxy.id})">
                        详情
                    </button>
                    <button class="bg-green-600/80 text-white px-3 py-1 rounded-lg text-sm font-semibold hover:shadow-neon transition-colors"
                        onclick="navigateToStreams('${(proxy.vhost || '__defaultVhost__').replace(/'/g, "\\'")}', '${(proxy.app || '').replace(/'/g, "\\'")}', '${(proxy.stream || '').replace(/'/g, "\\'")}')">
                        查看流
                    </button>
                    <button class="bg-red-500/80 text-white px-3 py-1 rounded-lg text-sm font-semibold hover:shadow-neon transition-colors"
                        onclick="deletePullProxy('${proxy.vhost || '__defaultVhost__'}', '${proxy.app}', '${proxy.stream}', ${proxy.id})">
                        删除
                    </button>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;

    // ---- 分页控件 ----
    if (pagination) pagination.classList.remove('hidden');
    if (pageInfo) pageInfo.textContent = `共 ${total} 条，第 ${curPage} / ${totalPages} 页`;

    // 上/下页按钮
    if (prevBtn) {
        prevBtn.disabled = curPage <= 1;
        prevBtn.onclick = () => { _pullProxyState.page = curPage - 1; _renderPullProxyPage(); };
    }
    if (nextBtn) {
        nextBtn.disabled = curPage >= totalPages;
        nextBtn.onclick = () => { _pullProxyState.page = curPage + 1; _renderPullProxyPage(); };
    }

    // 页码按钮（最多显示 7 个：首、尾、当前±2，省略号）
    if (pageBtns) {
        const btnCls = (active) => active
            ? 'px-3 py-1 rounded-lg bg-primary text-white text-sm font-bold'
            : 'px-3 py-1 rounded-lg bg-white/10 text-white text-sm font-semibold hover:bg-white/20 transition-colors';

        const pages = _calcPageRange(curPage, totalPages);
        pageBtns.innerHTML = '';
        pages.forEach(p => {
            if (p === '...') {
                const span = document.createElement('span');
                span.className = 'px-2 py-1 text-white/40 text-sm';
                span.textContent = '…';
                pageBtns.appendChild(span);
            } else {
                const btn = document.createElement('button');
                btn.className = btnCls(p === curPage);
                btn.textContent = p;
                btn.onclick = () => { _pullProxyState.page = p; _renderPullProxyPage(); };
                pageBtns.appendChild(btn);
            }
        });
    }
}

// 计算要展示的页码序列，最多7个槽位
function _calcPageRange(cur, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const result = [];
    const add = (p) => { if (!result.includes(p)) result.push(p); };
    add(1);
    if (cur - 2 > 2) result.push('...');
    for (let p = Math.max(2, cur - 2); p <= Math.min(total - 1, cur + 2); p++) add(p);
    if (cur + 2 < total - 1) result.push('...');
    add(total);
    return result;
}

// ==================== 新增弹窗 ====================

async function openAddPullProxyModal() {
    showPullProxyModal('新增拉流代理', null, {});
}

async function viewPullProxyDetail(id) {
    try {
        const result = await Api.getStreamProxy(id);
        if (result.code === 0 && result.data) {
            const proxy = result.data;
            let protocolParams = {};
            let customParams = {};
            try { protocolParams = JSON.parse(proxy.protocol_params || '{}'); } catch (e) {}
            try { customParams = JSON.parse(proxy.custom_params || '{}'); } catch (e) {}
            // 合并到 proxy 对象方便 getValue 使用
            // schema / rtp_type / retry_count / timeout_sec 存在 custom_params 里，也提升到顶层
            const mergedData = { ...proxy, ...protocolParams, ...customParams };
            // 详情弹窗的自定义参数区域只显示真正"额外"的参数（排除已有专属字段的）
            const knownKeys = new Set(['schema', 'rtp_type', 'retry_count', 'timeout_sec']);
            const extraCustomParams = Object.fromEntries(
                Object.entries(customParams).filter(([k]) => !knownKeys.has(k))
            );
            showPullProxyModal('拉流代理详情（只读）', mergedData, {}, true, extraCustomParams);
        } else {
            showToast('获取详情失败: ' + (result.msg || '未知错误'), 'error');
        }
    } catch (e) {
        showToast('获取详情失败: ' + e.message, 'error');
    }
}

function showPullProxyModal(title, data, serverConfig = {}, readOnly = false, initialCustomParams = {}) {
    // 确保旧弹窗已关闭
    const oldModal = document.getElementById('pullProxyModalWrapper');
    if (oldModal) oldModal.remove();

    const getValue = (key, defaultValue = '') => {
        if (data && data[key] !== undefined && data[key] !== null) return data[key];
        if (serverConfig && serverConfig[key] !== undefined) return serverConfig[key];
        return defaultValue;
    };

    const disabledAttr = readOnly ? 'disabled' : '';
    const inputCls = readOnly
        ? 'w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white/60 cursor-not-allowed'
        : 'w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-primary';

    const wrapper = document.createElement('div');
    wrapper.id = 'pullProxyModalWrapper';
    wrapper.className = 'absolute inset-0 bg-black/70 backdrop-blur-sm flex items-start justify-center pointer-events-auto overflow-y-auto py-8';
    wrapper.style.zIndex = '20';

    wrapper.innerHTML = `
        <div class="bg-gray-900 rounded-xl p-6 w-full max-w-3xl mx-4 border border-white/20 shadow-2xl" id="pullProxyModalContent">
            <div class="flex justify-between items-center mb-6">
                <h3 class="text-xl font-bold text-white">${title}</h3>
                <button id="pullProxyModalClose" class="text-white/60 hover:text-white transition-colors">
                    <i class="fa fa-times text-2xl"></i>
                </button>
            </div>

            <form id="pullProxyForm" class="space-y-5">
                <input type="hidden" id="proxyId" value="${data ? (data.id || '') : ''}">

                <!-- 基本信息 -->
                <div class="bg-white/5 rounded-lg p-4">
                    <h4 class="text-base font-semibold text-white mb-4 pb-2 border-b border-white/10">基本信息</h4>
                    <div class="space-y-4">
                        <div>
                            <label class="block text-white/80 text-sm font-semibold mb-1">
                                拉流地址(url) <span class="text-red-400">*</span>
                            </label>
                            <input type="text" id="pullUrl" ${disabledAttr}
                                value="${getValue('url')}"
                                placeholder="支持rtsp[s]、rtmp[s]、hls、http[s]-ts、http[s]-flv、srt、webrtc[s]"
                                class="${inputCls}">
                        </div>
                        <div>
                            <label class="block text-white/80 text-sm font-semibold mb-1">备注(remark)</label>
                            <input type="text" id="pullRemark" ${disabledAttr}
                                value="${getValue('remark')}"
                                placeholder="选填，便于识别此代理用途"
                                class="${inputCls}">
                        </div>
                        <div class="grid grid-cols-3 gap-4">
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">虚拟主机(vhost)</label>
                                <input type="text" id="pullVhost" ${disabledAttr}
                                    value="${getValue('vhost', '__defaultVhost__')}"
                                    placeholder="__defaultVhost__"
                                    class="${inputCls}">
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">
                                    应用(app) <span class="text-red-400">*</span>
                                </label>
                                <input type="text" id="pullApp" ${disabledAttr}
                                    value="${getValue('app')}"
                                    placeholder="live"
                                    class="${inputCls}">
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">
                                    流ID(stream) <span class="text-red-400">*</span>
                                </label>
                                <input type="text" id="pullStream" ${disabledAttr}
                                    value="${getValue('stream')}"
                                    placeholder="test"
                                    class="${inputCls}">
                            </div>
                        </div>
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">重试次数(retry_count，-1=无限)</label>
                                <input type="number" id="retryCount" ${disabledAttr}
                                    value="${getValue('retry_count', '-1')}"
                                    placeholder="-1"
                                    class="${inputCls}">
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">超时时间(timeout_sec，秒)</label>
                                <input type="number" id="timeoutSec" ${disabledAttr}
                                    value="${getValue('timeout_sec', '')}"
                                    placeholder="10"
                                    class="${inputCls}">
                            </div>
                        </div>
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">
                                    按需拉流(on_demand)
                                    <span class="text-white/40 font-normal ml-1">— 有人播放时再拉流</span>
                                </label>
                                <select id="onDemand" ${disabledAttr}
                                    class="${inputCls}" style="color:white;">
                                    <option value="0" ${!getValue('on_demand') || getValue('on_demand') == '0' ? 'selected' : ''}>关闭（立即拉流）</option>
                                    <option value="1" ${getValue('on_demand') == '1' || getValue('on_demand') === true || getValue('on_demand') === 1 ? 'selected' : ''}>开启（按需拉流）</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">
                                    拉流协议(schema)
                                    <span class="text-white/40 font-normal ml-1">— URL无法判断协议时指定</span>
                                </label>
                                <select id="pullSchema" ${disabledAttr}
                                    class="${inputCls}" style="color:white;">
                                    <option value="" ${!getValue('schema') ? 'selected' : ''}>自动识别（默认）</option>
                                    <option value="hls" ${getValue('schema') === 'hls' ? 'selected' : ''}>hls</option>
                                    <option value="ts"  ${getValue('schema') === 'ts'  ? 'selected' : ''}>ts（HTTP-TS）</option>
                                    <option value="flv" ${getValue('schema') === 'flv' ? 'selected' : ''}>flv（HTTP-FLV）</option>
                                </select>
                            </div>
                        </div>
                        <div>
                            <label class="block text-white/80 text-sm font-semibold mb-1">RTSP拉流方式(rtp_type)</label>
                            <select id="rtpType" ${disabledAttr}
                                class="${inputCls}" style="color:white;">
                                <option value="" ${!getValue('rtp_type') ? 'selected' : ''}>默认（TCP）</option>
                                <option value="0" ${getValue('rtp_type') === '0' ? 'selected' : ''}>0 - TCP</option>
                                <option value="1" ${getValue('rtp_type') === '1' ? 'selected' : ''}>1 - UDP</option>
                                <option value="2" ${getValue('rtp_type') === '2' ? 'selected' : ''}>2 - 组播</option>
                            </select>
                        </div>
                    </div>
                </div>

                <!-- 转协议参数 -->
                <div class="bg-white/5 rounded-lg p-4">
                    <div class="flex justify-between items-center mb-4 pb-2 border-b border-white/10">
                        <h4 class="text-base font-semibold text-white">转协议参数</h4>
                        ${!readOnly ? `
                        <div class="flex space-x-2">
                            <button type="button" id="loadDefaultProtocolBtn"
                                class="bg-white/10 text-white px-3 py-1 rounded-lg text-xs font-semibold hover:bg-white/20 transition-colors">
                                <i class="fa fa-magic mr-1"></i>加载默认
                            </button>
                            <button type="button" id="loadPresetProtocolBtn"
                                class="bg-primary/30 text-white px-3 py-1 rounded-lg text-xs font-semibold hover:bg-primary/50 transition-colors">
                                <i class="fa fa-list mr-1"></i>从预设加载
                            </button>
                            <button type="button" id="clearProtocolBtn"
                                class="bg-red-500/20 text-red-400 px-3 py-1 rounded-lg text-xs font-semibold hover:bg-red-500/30 transition-colors">
                                <i class="fa fa-eraser mr-1"></i>清空
                            </button>
                        </div>` : ''}
                    </div>

                    <!-- 通用配置 -->
                    <div class="mb-4">
                        <h5 class="text-white/60 text-xs font-bold uppercase tracking-widest mb-3 border-b border-white/10 pb-1">通用配置</h5>
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">时间戳覆盖(modify_stamp)</label>
                                <select id="modifyStamp" ${disabledAttr} class="${inputCls}" style="color:white;">
                                    <option value="" ${!getValue('modify_stamp') ? 'selected' : ''}>默认</option>
                                    <option value="0" ${getValue('modify_stamp') === '0' ? 'selected' : ''}>0 - 绝对时间戳</option>
                                    <option value="1" ${getValue('modify_stamp') === '1' ? 'selected' : ''}>1 - 系统时间戳</option>
                                    <option value="2" ${getValue('modify_stamp') === '2' ? 'selected' : ''}>2 - 相对时间戳</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">开启音频(enable_audio)</label>
                                <select id="enableAudio" ${disabledAttr} class="${inputCls}" style="color:white;">
                                    <option value="" ${!getValue('enable_audio') ? 'selected' : ''}>默认</option>
                                    <option value="1" ${getValue('enable_audio') === '1' ? 'selected' : ''}>1 - 开启</option>
                                    <option value="0" ${getValue('enable_audio') === '0' ? 'selected' : ''}>0 - 关闭</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">添加静音音频(add_mute_audio)</label>
                                <select id="addMuteAudio" ${disabledAttr} class="${inputCls}" style="color:white;">
                                    <option value="" ${!getValue('add_mute_audio') ? 'selected' : ''}>默认</option>
                                    <option value="1" ${getValue('add_mute_audio') === '1' ? 'selected' : ''}>1 - 开启</option>
                                    <option value="0" ${getValue('add_mute_audio') === '0' ? 'selected' : ''}>0 - 关闭</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">自动关闭(auto_close)</label>
                                <select id="autoClose" ${disabledAttr} class="${inputCls}" style="color:white;">
                                    <option value="" ${!getValue('auto_close') ? 'selected' : ''}>默认</option>
                                    <option value="1" ${getValue('auto_close') === '1' ? 'selected' : ''}>1 - 开启</option>
                                    <option value="0" ${getValue('auto_close') === '0' ? 'selected' : ''}>0 - 关闭</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">平滑发送间隔(paced_sender_ms，毫秒)</label>
                                <input type="number" id="pacedSenderMs" ${disabledAttr}
                                    value="${getValue('paced_sender_ms')}"
                                    placeholder="0（关闭）"
                                    class="${inputCls}">
                            </div>
                        </div>
                    </div>

                    <!-- 转协议开关 -->
                    <div class="mb-4">
                        <h5 class="text-white/60 text-xs font-bold uppercase tracking-widest mb-3 border-b border-white/10 pb-1">转协议开关</h5>
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">开启HLS(enable_hls)</label>
                                <select id="enableHls" ${disabledAttr} class="${inputCls}" style="color:white;">
                                    <option value="" ${!getValue('enable_hls') ? 'selected' : ''}>默认</option>
                                    <option value="1" ${getValue('enable_hls') === '1' ? 'selected' : ''}>1 - 开启</option>
                                    <option value="0" ${getValue('enable_hls') === '0' ? 'selected' : ''}>0 - 关闭</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">开启HLS-FMP4(enable_hls_fmp4)</label>
                                <select id="enableHlsFmp4" ${disabledAttr} class="${inputCls}" style="color:white;">
                                    <option value="" ${!getValue('enable_hls_fmp4') ? 'selected' : ''}>默认</option>
                                    <option value="1" ${getValue('enable_hls_fmp4') === '1' ? 'selected' : ''}>1 - 开启</option>
                                    <option value="0" ${getValue('enable_hls_fmp4') === '0' ? 'selected' : ''}>0 - 关闭</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">开启MP4录制(enable_mp4)</label>
                                <select id="enableMp4" ${disabledAttr} class="${inputCls}" style="color:white;">
                                    <option value="" ${!getValue('enable_mp4') ? 'selected' : ''}>默认</option>
                                    <option value="1" ${getValue('enable_mp4') === '1' ? 'selected' : ''}>1 - 开启</option>
                                    <option value="0" ${getValue('enable_mp4') === '0' ? 'selected' : ''}>0 - 关闭</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">开启RTSP(enable_rtsp)</label>
                                <select id="enableRtsp" ${disabledAttr} class="${inputCls}" style="color:white;">
                                    <option value="" ${!getValue('enable_rtsp') ? 'selected' : ''}>默认</option>
                                    <option value="1" ${getValue('enable_rtsp') === '1' ? 'selected' : ''}>1 - 开启</option>
                                    <option value="0" ${getValue('enable_rtsp') === '0' ? 'selected' : ''}>0 - 关闭</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">开启RTMP/FLV(enable_rtmp)</label>
                                <select id="enableRtmp" ${disabledAttr} class="${inputCls}" style="color:white;">
                                    <option value="" ${!getValue('enable_rtmp') ? 'selected' : ''}>默认</option>
                                    <option value="1" ${getValue('enable_rtmp') === '1' ? 'selected' : ''}>1 - 开启</option>
                                    <option value="0" ${getValue('enable_rtmp') === '0' ? 'selected' : ''}>0 - 关闭</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">开启HTTP-TS(enable_ts)</label>
                                <select id="enableTs" ${disabledAttr} class="${inputCls}" style="color:white;">
                                    <option value="" ${!getValue('enable_ts') ? 'selected' : ''}>默认</option>
                                    <option value="1" ${getValue('enable_ts') === '1' ? 'selected' : ''}>1 - 开启</option>
                                    <option value="0" ${getValue('enable_ts') === '0' ? 'selected' : ''}>0 - 关闭</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">开启FMP4(enable_fmp4)</label>
                                <select id="enableFmp4" ${disabledAttr} class="${inputCls}" style="color:white;">
                                    <option value="" ${!getValue('enable_fmp4') ? 'selected' : ''}>默认</option>
                                    <option value="1" ${getValue('enable_fmp4') === '1' ? 'selected' : ''}>1 - 开启</option>
                                    <option value="0" ${getValue('enable_fmp4') === '0' ? 'selected' : ''}>0 - 关闭</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <!-- 按需转协议 -->
                    <div class="mb-4">
                        <h5 class="text-white/60 text-xs font-bold uppercase tracking-widest mb-3 border-b border-white/10 pb-1">按需转协议</h5>
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">HLS按需生成(hls_demand)</label>
                                <select id="hlsDemand" ${disabledAttr} class="${inputCls}" style="color:white;">
                                    <option value="" ${!getValue('hls_demand') ? 'selected' : ''}>默认</option>
                                    <option value="1" ${getValue('hls_demand') === '1' ? 'selected' : ''}>1 - 开启</option>
                                    <option value="0" ${getValue('hls_demand') === '0' ? 'selected' : ''}>0 - 关闭</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">RTSP按需生成(rtsp_demand)</label>
                                <select id="rtspDemand" ${disabledAttr} class="${inputCls}" style="color:white;">
                                    <option value="" ${!getValue('rtsp_demand') ? 'selected' : ''}>默认</option>
                                    <option value="1" ${getValue('rtsp_demand') === '1' ? 'selected' : ''}>1 - 开启</option>
                                    <option value="0" ${getValue('rtsp_demand') === '0' ? 'selected' : ''}>0 - 关闭</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">RTMP按需生成(rtmp_demand)</label>
                                <select id="rtmpDemand" ${disabledAttr} class="${inputCls}" style="color:white;">
                                    <option value="" ${!getValue('rtmp_demand') ? 'selected' : ''}>默认</option>
                                    <option value="1" ${getValue('rtmp_demand') === '1' ? 'selected' : ''}>1 - 开启</option>
                                    <option value="0" ${getValue('rtmp_demand') === '0' ? 'selected' : ''}>0 - 关闭</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">TS按需生成(ts_demand)</label>
                                <select id="tsDemand" ${disabledAttr} class="${inputCls}" style="color:white;">
                                    <option value="" ${!getValue('ts_demand') ? 'selected' : ''}>默认</option>
                                    <option value="1" ${getValue('ts_demand') === '1' ? 'selected' : ''}>1 - 开启</option>
                                    <option value="0" ${getValue('ts_demand') === '0' ? 'selected' : ''}>0 - 关闭</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">FMP4按需生成(fmp4_demand)</label>
                                <select id="fmp4Demand" ${disabledAttr} class="${inputCls}" style="color:white;">
                                    <option value="" ${!getValue('fmp4_demand') ? 'selected' : ''}>默认</option>
                                    <option value="1" ${getValue('fmp4_demand') === '1' ? 'selected' : ''}>1 - 开启</option>
                                    <option value="0" ${getValue('fmp4_demand') === '0' ? 'selected' : ''}>0 - 关闭</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <!-- 录制配置 -->
                    <div>
                        <h5 class="text-white/60 text-xs font-bold uppercase tracking-widest mb-3 border-b border-white/10 pb-1">录制配置</h5>
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">MP4计入观看数(mp4_as_player)</label>
                                <select id="mp4AsPlayer" ${disabledAttr} class="${inputCls}" style="color:white;">
                                    <option value="" ${!getValue('mp4_as_player') ? 'selected' : ''}>默认</option>
                                    <option value="1" ${getValue('mp4_as_player') === '1' ? 'selected' : ''}>1 - 开启</option>
                                    <option value="0" ${getValue('mp4_as_player') === '0' ? 'selected' : ''}>0 - 关闭</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">MP4切片大小(mp4_max_second，秒)</label>
                                <input type="number" id="mp4MaxSecond" ${disabledAttr}
                                    value="${getValue('mp4_max_second')}"
                                    placeholder="3600"
                                    class="${inputCls}">
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">MP4保存路径(mp4_save_path)</label>
                                <input type="text" id="mp4SavePath" ${disabledAttr}
                                    value="${getValue('mp4_save_path')}"
                                    placeholder="./www"
                                    class="${inputCls}">
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">HLS保存路径(hls_save_path)</label>
                                <input type="text" id="hlsSavePath" ${disabledAttr}
                                    value="${getValue('hls_save_path')}"
                                    placeholder="./www"
                                    class="${inputCls}">
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 自定义参数 -->
                <div class="bg-white/5 rounded-lg p-4">
                    <div class="flex justify-between items-center mb-4 pb-2 border-b border-white/10">
                        <h4 class="text-base font-semibold text-white">自定义参数（追加到 ZLMediaKit addStreamProxy）</h4>
                        ${!readOnly ? `
                        <button type="button" id="addCustomParamBtn"
                            class="bg-primary/30 text-white px-3 py-1 rounded-lg text-xs font-semibold hover:bg-primary/50 transition-colors">
                            <i class="fa fa-plus mr-1"></i>添加参数
                        </button>` : ''}
                    </div>
                    <div id="customParamsContainer" class="space-y-2">
                        <!-- 动态填充 -->
                    </div>
                </div>

                ${!readOnly ? `
                <div class="flex justify-end space-x-3 pt-2">
                    <button type="button" id="pullProxyModalCancel"
                        class="bg-white/10 text-white px-6 py-2 rounded-lg font-semibold hover:bg-white/20 transition-colors">
                        取消
                    </button>
                    <button type="submit"
                        class="bg-gradient-primary text-white px-6 py-2 rounded-lg font-semibold hover:shadow-neon transition-all duration-300">
                        <i class="fa fa-save mr-2"></i>保存并添加代理
                    </button>
                </div>` : `
                <div class="flex justify-end pt-2">
                    <button type="button" id="pullProxyModalCancel"
                        class="bg-white/10 text-white px-6 py-2 rounded-lg font-semibold hover:bg-white/20 transition-colors">
                        关闭
                    </button>
                </div>`}
            </form>
        </div>
    `;

    // 挂载到专属容器并激活鼠标事件
    const container = document.getElementById('pull-proxy-modal-container');
    if (container) {
        container.style.pointerEvents = 'auto';
        container.appendChild(wrapper);
    } else {
        // 降级：直接挂到 body（fixed 定位）
        wrapper.style.position = 'fixed';
        wrapper.style.zIndex = '9999';
        document.body.appendChild(wrapper);
    }

    // 填充初始自定义参数
    Object.entries(initialCustomParams).forEach(([k, v]) => {
        addCustomParamRow(k, v, readOnly);
    });

    // ---- 事件绑定 ----
    const closeModal = () => {
        wrapper.remove();
        const c = document.getElementById('pull-proxy-modal-container');
        if (c) c.style.pointerEvents = 'none';
    };

    wrapper.addEventListener('click', e => { if (e.target === wrapper) closeModal(); });
    document.getElementById('pullProxyModalClose').addEventListener('click', closeModal);
    const cancelBtn = document.getElementById('pullProxyModalCancel');
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    if (!readOnly) {
        document.getElementById('loadDefaultProtocolBtn').addEventListener('click', loadDefaultProtocolParams);
        document.getElementById('loadPresetProtocolBtn').addEventListener('click', loadPresetProtocolParams);
        document.getElementById('clearProtocolBtn').addEventListener('click', clearProtocolParams);
        document.getElementById('addCustomParamBtn').addEventListener('click', () => addCustomParamRow());

        document.getElementById('pullProxyForm').addEventListener('submit', async function (e) {
            e.preventDefault();
            await submitAddPullProxy(closeModal);
        });
    }
}

// ==================== 表单提交 ====================

async function submitAddPullProxy(closeModal) {
    const url     = document.getElementById('pullUrl').value.trim();
    const vhost   = document.getElementById('pullVhost').value.trim() || '__defaultVhost__';
    const app     = document.getElementById('pullApp').value.trim();
    const stream  = document.getElementById('pullStream').value.trim();

    if (!url || !app || !stream) {
        showToast('拉流地址、应用名、流ID 不能为空', 'error');
        return;
    }

    // 收集转协议参数（非空才放入）
    const protocolMap = {
        enable_hls:        'enableHls',
        enable_hls_fmp4:   'enableHlsFmp4',
        enable_mp4:        'enableMp4',
        enable_rtsp:       'enableRtsp',
        enable_rtmp:       'enableRtmp',
        enable_ts:         'enableTs',
        enable_fmp4:       'enableFmp4',
        enable_audio:      'enableAudio',
        add_mute_audio:    'addMuteAudio',
        auto_close:        'autoClose',
        hls_demand:        'hlsDemand',
        rtsp_demand:       'rtspDemand',
        rtmp_demand:       'rtmpDemand',
        ts_demand:         'tsDemand',
        fmp4_demand:       'fmp4Demand',
        mp4_as_player:     'mp4AsPlayer',
        modify_stamp:      'modifyStamp',
        paced_sender_ms:   'pacedSenderMs',
        mp4_max_second:    'mp4MaxSecond',
        mp4_save_path:     'mp4SavePath',
        hls_save_path:     'hlsSavePath',
    };
    const protocolParams = {};
    Object.entries(protocolMap).forEach(([apiKey, domId]) => {
        const el = document.getElementById(domId);
        if (el && el.value !== '') protocolParams[apiKey] = el.value;
    });

    // 自定义参数
    const customParams = {};
    document.querySelectorAll('#customParamsContainer .custom-param-row').forEach(row => {
        const k = row.querySelector('.custom-param-key').value.trim();
        const v = row.querySelector('.custom-param-value').value.trim();
        if (k) customParams[k] = v;
    });

    // 其他 ZLM 参数
    const retryCount  = document.getElementById('retryCount').value;
    const timeoutSec  = document.getElementById('timeoutSec').value;
    const rtpType     = document.getElementById('rtpType').value;
    const schema      = document.getElementById('pullSchema').value;
    const onDemand    = document.getElementById('onDemand').value;  // "0" or "1"
    if (retryCount !== '') customParams['retry_count'] = retryCount;
    if (timeoutSec !== '') customParams['timeout_sec'] = timeoutSec;
    if (rtpType    !== '') customParams['rtp_type']    = rtpType;
    if (schema     !== '') customParams['schema']      = schema;

    const remark = (document.getElementById('pullRemark')?.value || '').trim();

    const formData = {
        url,
        vhost,
        app,
        stream,
        remark,
        on_demand: onDemand,
        protocol_params: JSON.stringify(protocolParams),
        custom_params:   JSON.stringify(customParams),
    };

    // 按钮状态
    const submitBtn = document.querySelector('#pullProxyForm button[type="submit"]');
    const origText  = submitBtn ? submitBtn.innerHTML : '';
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa fa-spinner fa-spin mr-2"></i>提交中...';
    }

    try {
        const result = await Api.addStreamProxy(formData);
        if (result.code === 0) {
            showToast('添加成功', 'success');
            closeModal();
            loadPullProxyList();
        } else {
            showToast('添加失败: ' + (result.msg || '未知错误'), 'error');
        }
    } catch (error) {
        showToast('添加失败: ' + error.message, 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = origText;
        }
    }
}

// ==================== 参数辅助函数 ====================

function addCustomParamRow(key = '', value = '', readOnly = false) {
    const container = document.getElementById('customParamsContainer');
    if (!container) return;
    const disabledAttr = readOnly ? 'disabled' : '';
    const row = document.createElement('div');
    row.className = 'custom-param-row flex space-x-2';
    row.innerHTML = `
        <input type="text" ${disabledAttr}
            class="custom-param-key flex-1 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-primary text-sm"
            placeholder="参数名 (如 retry_count)" value="${key}">
        <input type="text" ${disabledAttr}
            class="custom-param-value flex-1 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-primary text-sm"
            placeholder="参数值" value="${value}">
        ${!readOnly ? `<button type="button"
            class="bg-red-500/20 text-red-400 px-3 py-2 rounded-lg hover:bg-red-500/30 transition-colors flex-shrink-0"
            onclick="this.parentElement.remove()">
            <i class="fa fa-times"></i>
        </button>` : ''}
    `;
    container.appendChild(row);
}

async function loadDefaultProtocolParams() {
    // dom id  <-->  protocol.xxx 字段名映射
    const fieldMap = {
        modifyStamp:   'modify_stamp',
        pacedSenderMs: 'paced_sender_ms',
        enableAudio:   'enable_audio',
        addMuteAudio:  'add_mute_audio',
        autoClose:     'auto_close',
        enableHls:     'enable_hls',
        enableHlsFmp4: 'enable_hls_fmp4',
        enableMp4:     'enable_mp4',
        enableRtsp:    'enable_rtsp',
        enableRtmp:    'enable_rtmp',
        enableTs:      'enable_ts',
        enableFmp4:    'enable_fmp4',
        hlsDemand:     'hls_demand',
        rtspDemand:    'rtsp_demand',
        rtmpDemand:    'rtmp_demand',
        tsDemand:      'ts_demand',
        fmp4Demand:    'fmp4_demand',
        mp4AsPlayer:   'mp4_as_player',
        mp4MaxSecond:  'mp4_max_second',
        mp4SavePath:   'mp4_save_path',
        hlsSavePath:   'hls_save_path',
    };

    try {
        const result = await Api.getServerConfig();
        if (result.code === 0 && result.data && result.data.length > 0) {
            const serverConfig = result.data[0] || {};
            let applied = 0;
            Object.entries(fieldMap).forEach(([domId, configKey]) => {
                const fullKey = `protocol.${configKey}`;
                const el = document.getElementById(domId);
                if (el && serverConfig[fullKey] !== undefined && serverConfig[fullKey] !== null) {
                    el.value = String(serverConfig[fullKey]);
                    applied++;
                }
            });
            showToast(`已从服务器加载 ${applied} 个默认转协议参数`, 'success');
        } else {
            showToast('获取服务器配置失败: ' + (result.msg || '未知错误'), 'error');
        }
    } catch (e) {
        showToast('获取服务器配置失败: ' + e.message, 'error');
    }
}

function clearProtocolParams() {
    const ids = [
        'modifyStamp', 'pacedSenderMs', 'enableAudio', 'addMuteAudio', 'autoClose',
        'enableHls', 'enableHlsFmp4', 'enableMp4', 'enableRtsp', 'enableRtmp',
        'enableTs', 'enableFmp4', 'hlsDemand', 'rtspDemand', 'rtmpDemand',
        'tsDemand', 'fmp4Demand', 'mp4AsPlayer', 'mp4MaxSecond', 'mp4SavePath',
        'hlsSavePath',
    ];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    showToast('转协议参数已清空', 'info');
}

async function loadPresetProtocolParams() {
    try {
        const result = await Api.getProtocolOptionsList();
        if (result.code !== 0 || !result.data || result.data.length === 0) {
            showToast('暂无可用预设，请先在「协议配置」中添加', 'warning');
            return;
        }
        const presetList = result.data;

        const presetModal = document.createElement('div');
        presetModal.id = 'presetPickerModal';
        presetModal.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50';
        presetModal.innerHTML = `
            <div class="bg-gray-900 rounded-xl p-6 max-w-md w-full mx-4 border border-white/20" onclick="event.stopPropagation()">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-xl font-bold text-white">选择协议预设</h3>
                    <button onclick="document.getElementById('presetPickerModal').remove()" class="text-white/60 hover:text-white">
                        <i class="fa fa-times text-2xl"></i>
                    </button>
                </div>
                <select id="presetSelect" class="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white mb-4 focus:outline-none focus:ring-2 focus:ring-primary">
                    <option value="">-- 请选择预设 --</option>
                    ${presetList.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
                </select>
                <div class="flex justify-end space-x-3">
                    <button onclick="document.getElementById('presetPickerModal').remove()"
                        class="bg-white/10 text-white px-5 py-2 rounded-lg font-semibold hover:bg-white/20 transition-colors">取消</button>
                    <button onclick="applyPreset()"
                        class="bg-gradient-primary text-white px-5 py-2 rounded-lg font-semibold hover:shadow-neon transition-all duration-300">确定</button>
                </div>
            </div>
        `;
        document.body.appendChild(presetModal);
        presetModal.addEventListener('click', e => { if (e.target === presetModal) presetModal.remove(); });
    } catch (e) {
        showToast('获取预设列表失败: ' + e.message, 'error');
    }
}

async function applyPreset() {
    const presetId = document.getElementById('presetSelect').value;
    if (!presetId) { showToast('请先选择一个预设', 'warning'); return; }
    try {
        const result = await Api.getProtocolOptions(parseInt(presetId));
        if (result.code === 0 && result.data) {
            const p = result.data;
            const fieldMap = {
                modify_stamp:     'modifyStamp',
                paced_sender_ms:  'pacedSenderMs',
                enable_audio:     'enableAudio',
                add_mute_audio:   'addMuteAudio',
                auto_close:       'autoClose',
                enable_hls:       'enableHls',
                enable_hls_fmp4:  'enableHlsFmp4',
                enable_mp4:       'enableMp4',
                enable_rtsp:      'enableRtsp',
                enable_rtmp:      'enableRtmp',
                enable_ts:        'enableTs',
                enable_fmp4:      'enableFmp4',
                hls_demand:       'hlsDemand',
                rtsp_demand:      'rtspDemand',
                rtmp_demand:      'rtmpDemand',
                ts_demand:        'tsDemand',
                fmp4_demand:      'fmp4Demand',
                mp4_as_player:    'mp4AsPlayer',
                mp4_max_second:   'mp4MaxSecond',
                mp4_save_path:    'mp4SavePath',
                hls_save_path:    'hlsSavePath',
            };
            Object.entries(fieldMap).forEach(([apiKey, domId]) => {
                const el = document.getElementById(domId);
                if (el && p[apiKey] !== null && p[apiKey] !== undefined) el.value = p[apiKey];
            });
            document.getElementById('presetPickerModal').remove();
            showToast(`已加载预设「${p.name}」`, 'success');
        } else {
            showToast('获取预设详情失败: ' + (result.msg || ''), 'error');
        }
    } catch (e) {
        showToast('加载预设失败: ' + e.message, 'error');
    }
}

// ==================== 删除 ====================

async function deletePullProxy(vhost, app, stream, dbId) {
    showConfirmModal(
        '确认删除拉流代理',
        `确定要删除 <b>${app}/${stream}</b> 的拉流代理吗？<br>此操作将同时从 ZLMediaKit 和数据库中移除。`,
        async function () {
            try {
                const result = await Api.delStreamProxy(dbId);
                if (result.code === 0) {
                    showToast('删除成功', 'success');
                    loadPullProxyList();
                } else {
                    showToast('删除失败: ' + (result.msg || '未知错误'), 'error');
                }
            } catch (error) {
                showToast('删除失败: ' + error.message, 'error');
            }
        }
    );
}

/**
 * 切换拉流代理模式
 * @param {number} id        数据库 ID
 * @param {number} onDemand  当前模式：1=按需，0=立即
 */
async function togglePullProxyMode(id, onDemand) {
    const fromText = onDemand ? '按需' : '立即';
    const toText   = onDemand ? '立即' : '按需';
    const msg      = onDemand
        ? `确定将该代理切换为<b>立即模式</b>？<br>将立即向 ZLMediaKit 发起拉流请求。`
        : `确定将该代理切换为<b>按需模式</b>？<br>将停止当前拉流，等待有观众时再自动拉起。`;

    showConfirmModal(
        `切换模式：${fromText} → ${toText}`,
        msg,
        async function () {
            try {
                const result = await Api.toggleStreamProxyMode(id);
                if (result.code === 0) {
                    showToast(result.msg || '切换成功', 'success');
                    loadPullProxyList();
                } else {
                    showToast('切换失败: ' + (result.msg || '未知错误'), 'error');
                }
            } catch (error) {
                showToast('切换失败: ' + error.message, 'error');
            }
        }
    );
}

// ==================== 页面清理 ====================

function cleanupPullProxyPage() {
    const wrapper = document.getElementById('pullProxyModalWrapper');
    if (wrapper) wrapper.remove();
    const container = document.getElementById('pull-proxy-modal-container');
    if (container) {
        container.innerHTML = '';
        container.style.pointerEvents = 'none';
    }
}

// ==================== ZLM 状态详情弹窗 ====================

function showProxyStatusDetail(cacheKey) {
    const data = _pullProxyStatusCache['__detail__' + cacheKey];
    if (!data) { showToast('状态数据不存在', 'warning'); return; }

    const statusMap = {
        'playing':    { label: '拉流中', cls: 'bg-green-500/20 text-green-400'  },
        'idle':       { label: '空闲',   cls: 'bg-white/10 text-white/50'       },
        'connecting': { label: '连接中', cls: 'bg-yellow-500/20 text-yellow-400'},
        'error':      { label: '错误',   cls: 'bg-red-500/20 text-red-400'      },
    };
    const ss    = data.status_str || '';
    const sInfo = statusMap[ss] || { label: ss || '未知', cls: 'bg-red-500/20 text-red-400' };

    // tracks 渲染
    const codecTypeMap = { 0: '视频', 1: '音频' };
    let tracksHtml = '';
    if (Array.isArray(data.tracks) && data.tracks.length > 0) {
        data.tracks.forEach((t, i) => {
            const type = codecTypeMap[t.codec_type] ?? t.codec_type;
            const ready = t.ready
                ? '<span class="text-green-400">✓ 就绪</span>'
                : '<span class="text-red-400">✗ 未就绪</span>';
            let extraRows = '';
            if (t.codec_type === 0) {
                // 视频
                extraRows = `
                    <tr><td class="text-white/50 pr-4 py-0.5">分辨率</td><td class="text-white">${t.width ?? '-'} × ${t.height ?? '-'}</td></tr>
                    <tr><td class="text-white/50 pr-4 py-0.5">帧率</td><td class="text-white">${t.fps ?? '-'} fps</td></tr>
                    <tr><td class="text-white/50 pr-4 py-0.5">GOP大小</td><td class="text-white">${t.gop_size ?? '-'} 帧 / ${t.gop_interval_ms ?? '-'} ms</td></tr>
                    <tr><td class="text-white/50 pr-4 py-0.5">关键帧数</td><td class="text-white">${t.key_frames ?? '-'}</td></tr>`;
            } else {
                // 音频
                extraRows = `
                    <tr><td class="text-white/50 pr-4 py-0.5">声道数</td><td class="text-white">${t.channels ?? '-'}</td></tr>
                    <tr><td class="text-white/50 pr-4 py-0.5">采样率</td><td class="text-white">${t.sample_rate ?? '-'} Hz</td></tr>
                    <tr><td class="text-white/50 pr-4 py-0.5">位深</td><td class="text-white">${t.sample_bit ?? '-'} bit</td></tr>`;
            }
            tracksHtml += `
                <div class="bg-white/5 rounded-lg px-4 py-3">
                    <div class="text-white/50 text-xs font-bold uppercase tracking-widest mb-2">
                        Track ${i + 1} — ${type} / ${t.codec_id_name ?? '-'}
                    </div>
                    <table class="text-sm w-full">
                        <tr><td class="text-white/50 pr-4 py-0.5">就绪</td><td>${ready}</td></tr>
                        <tr><td class="text-white/50 pr-4 py-0.5">总帧数</td><td class="text-white">${t.frames ?? '-'}</td></tr>
                        <tr><td class="text-white/50 pr-4 py-0.5">时长</td><td class="text-white">${t.duration != null ? (t.duration / 1000).toFixed(1) + ' 秒' : '-'}</td></tr>
                        ${extraRows}
                    </table>
                </div>`;
        });
    } else {
        tracksHtml = `<div class="text-white/30 text-sm col-span-2">暂无 Track 信息</div>`;
    }

    const modal = document.createElement('div');
    modal.id = 'proxyStatusDetailModal';
    modal.className = 'absolute inset-0 bg-black/80 backdrop-blur-sm flex items-start justify-center overflow-y-auto py-8 pointer-events-auto';
    modal.style.zIndex = '20';
    modal.innerHTML = `
        <div class="bg-gray-900 rounded-xl p-6 max-w-2xl w-full mx-4 border border-white/20 shadow-2xl" onclick="event.stopPropagation()">

            <!-- 标题 -->
            <div class="flex justify-between items-center mb-5">
                <div class="flex items-center gap-3">
                    <h3 class="text-xl font-bold text-white">拉流状态详情</h3>
                    <span class="px-3 py-1 rounded-full text-xs font-semibold ${sInfo.cls}">${sInfo.label}</span>
                </div>
                <button onclick="window._closeProxyStatusModal()" class="text-white/60 hover:text-white">
                    <i class="fa fa-times text-2xl"></i>
                </button>
            </div>

            <!-- 基础信息 -->
            <div class="mb-4">
                <h4 class="text-white/50 text-xs font-bold uppercase tracking-widest mb-2">基础信息</h4>
                <div class="grid grid-cols-2 gap-3">
                    <div class="bg-white/5 rounded-lg px-4 py-3 col-span-2">
                        <div class="text-white/50 text-xs mb-1">Key</div>
                        <div class="text-white text-sm font-mono break-all">${data.key ?? '-'}</div>
                    </div>
                    <div class="bg-white/5 rounded-lg px-4 py-3 col-span-2">
                        <div class="text-white/50 text-xs mb-1">拉流地址 (url)</div>
                        <div class="text-white/80 text-sm font-mono break-all">${data.url ?? '-'}</div>
                    </div>
                    <div class="bg-white/5 rounded-lg px-4 py-3">
                        <div class="text-white/50 text-xs mb-1">状态码 (status)</div>
                        <div class="text-white text-sm">${data.status ?? '-'}</div>
                    </div>
                    <div class="bg-white/5 rounded-lg px-4 py-3">
                        <div class="text-white/50 text-xs mb-1">状态 (status_str)</div>
                        <div class="text-sm font-semibold ${sInfo.cls.replace(/bg-\S+/,'').trim()}">${ss || '-'}</div>
                    </div>
                    <div class="bg-white/5 rounded-lg px-4 py-3">
                        <div class="text-white/50 text-xs mb-1">在线时长 (liveSecs)</div>
                        <div class="text-white text-sm">${data.liveSecs != null ? data.liveSecs + ' 秒' : '-'}</div>
                    </div>
                    <div class="bg-white/5 rounded-lg px-4 py-3">
                        <div class="text-white/50 text-xs mb-1">重拉次数 (rePullCount)</div>
                        <div class="text-white text-sm">${data.rePullCount ?? '-'}</div>
                    </div>
                    <div class="bg-white/5 rounded-lg px-4 py-3">
                        <div class="text-white/50 text-xs mb-1">实时速率 (bytesSpeed)</div>
                        <div class="text-white text-sm">${data.bytesSpeed != null ? (data.bytesSpeed / 1024).toFixed(1) + ' KB/s' : '-'}</div>
                    </div>
                    <div class="bg-white/5 rounded-lg px-4 py-3">
                        <div class="text-white/50 text-xs mb-1">累计流量 (totalBytes)</div>
                        <div class="text-white text-sm">${data.totalBytes != null ? (data.totalBytes / 1024 / 1024).toFixed(2) + ' MB' : '-'}</div>
                    </div>
                    <div class="bg-white/5 rounded-lg px-4 py-3">
                        <div class="text-white/50 text-xs mb-1">观看人数 (totalReaderCount)</div>
                        <div class="text-white text-sm">${data.totalReaderCount ?? '-'}</div>
                    </div>
                </div>
            </div>

            <!-- src 信息 -->
            <div class="mb-4">
                <h4 class="text-white/50 text-xs font-bold uppercase tracking-widest mb-2">来源信息 (src)</h4>
                <div class="grid grid-cols-2 gap-3">
                    <div class="bg-white/5 rounded-lg px-4 py-3">
                        <div class="text-white/50 text-xs mb-1">vhost</div>
                        <div class="text-white text-sm font-mono">${data.src?.vhost ?? '-'}</div>
                    </div>
                    <div class="bg-white/5 rounded-lg px-4 py-3">
                        <div class="text-white/50 text-xs mb-1">app</div>
                        <div class="text-white text-sm font-mono">${data.src?.app ?? '-'}</div>
                    </div>
                    <div class="bg-white/5 rounded-lg px-4 py-3">
                        <div class="text-white/50 text-xs mb-1">stream</div>
                        <div class="text-white text-sm font-mono">${data.src?.stream ?? '-'}</div>
                    </div>
                    <div class="bg-white/5 rounded-lg px-4 py-3">
                        <div class="text-white/50 text-xs mb-1">params</div>
                        <div class="text-white text-sm font-mono break-all">${data.src?.params || '(空)'}</div>
                    </div>
                </div>
            </div>

            <!-- Tracks -->
            <div class="mb-5">
                <h4 class="text-white/50 text-xs font-bold uppercase tracking-widest mb-2">媒体轨道 (tracks)</h4>
                <div class="grid grid-cols-2 gap-3">
                    ${tracksHtml}
                </div>
            </div>

            <div class="flex justify-between items-center">
                <button id="proxyStatusRefreshBtn"
                    class="flex items-center gap-2 bg-primary/30 text-white px-5 py-2 rounded-lg font-semibold hover:bg-primary/50 transition-colors">
                    <i class="fa fa-refresh"></i>刷新
                </button>
                <button onclick="window._closeProxyStatusModal()"
                    class="bg-white/10 text-white px-5 py-2 rounded-lg font-semibold hover:bg-white/20 transition-colors">
                    关闭
                </button>
            </div>
        </div>
    `;
    // 挂载到专属容器（absolute 定位，只覆盖当前标签页）
    const container = document.getElementById('pull-proxy-modal-container');
    if (container) {
        container.style.pointerEvents = 'auto';
        container.appendChild(modal);
    } else {
        modal.style.position = 'fixed';
        modal.style.zIndex = '9999';
        document.body.appendChild(modal);
    }

    // 统一关闭函数：移除弹窗并还原容器鼠标事件
    const closeStatusModal = () => {
        const el = document.getElementById('proxyStatusDetailModal');
        if (el) el.remove();
        const c = document.getElementById('pull-proxy-modal-container');
        if (c) c.style.pointerEvents = 'none';
    };
    // 暴露到 window，供 innerHTML 中的 onclick 调用
    window._closeProxyStatusModal = closeStatusModal;

    modal.addEventListener('click', e => { if (e.target === modal) closeStatusModal(); });

    // 刷新按钮：重新查询 ZLM 状态后重建弹窗
    document.getElementById('proxyStatusRefreshBtn').addEventListener('click', async function () {
        const btn = this;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> 刷新中...';
        try {
            const res = await Api.listStreamProxy(cacheKey);
            if (res && res.code === 0 && Array.isArray(res.data) && res.data.length > 0) {
                _pullProxyStatusCache[cacheKey] = res.data[0];
                _pullProxyStatusCache['__detail__' + cacheKey] = res.data[0];
            } else {
                _pullProxyStatusCache[cacheKey] = null;
                delete _pullProxyStatusCache['__detail__' + cacheKey];
            }
        } catch (e) {
            showToast('刷新失败: ' + e.message, 'error');
        }
        closeStatusModal();
        // 重新打开弹窗（若仍有数据）
        if (_pullProxyStatusCache['__detail__' + cacheKey]) {
            showProxyStatusDetail(cacheKey);
        } else {
            showToast('代理已离线', 'warning');
            _renderPullProxyPage(); // 同步更新列表状态列
        }
    });
}

