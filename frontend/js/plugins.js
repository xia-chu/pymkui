/**
 * plugins.js — 插件管理页面逻辑
 * 数据结构（新版）：
 *   _bindings = [
 *     { event_type: "on_publish", bindings: [{id, plugin_name, params, priority, enabled}, ...] },
 *     ...
 *   ]
 */

// ── 状态 ────────────────────────────────────────────────────────────
let _allPlugins   = [];   // 已加载插件列表
let _allEvents    = [];   // 支持的事件类型
let _bindings     = [];   // 事件绑定配置（新结构）
let _editEvent    = null; // 当前编辑的事件类型
let _dragSource   = null; // 拖拽源元素
// 编辑绑定弹窗中已绑定插件的有序数组：[{ pluginName, paramKey }, ...]
let _selectedBindings = [];
// 参数弹窗状态
let _paramsPlugin = null; // 当前编辑参数的 paramKey
let _paramsEvent  = null;
// 编辑弹窗中每个绑定实例的临时 params（key = paramKey）
let _editParams   = {};

// ── API 封装 ──────────────────────────────────────────────────────
async function apiGet(path) {
    return await Api.request(path, { method: 'GET' });
}
async function apiPost(path, body) {
    return await Api.request(path, { method: 'POST', body });
}

// ── 初始化 ──────────────────────────────────────────────────────────
async function initPluginsPage() {
    await Promise.all([loadPluginList(), loadEventBindings()]);
    document.getElementById('reloadPluginsBtn')
        .addEventListener('click', reloadPlugins);
}

// ── 加载插件列表 ──────────────────────────────────────────────────────
async function loadPluginList() {
    try {
        const res = await apiGet('/index/pyapi/plugin/list');
        _allPlugins = res.data || [];
        renderPluginList();
    } catch (e) {
        document.getElementById('pluginList').innerHTML =
            `<div class="col-span-full text-red-400 py-6 text-center"><i class="fa fa-exclamation-circle mr-2"></i>${e.message}</div>`;
    }
}

function renderPluginList() {
    const container = document.getElementById('pluginList');
    document.getElementById('pluginCount').textContent = `共 ${_allPlugins.length} 个`;

    if (!_allPlugins.length) {
        container.innerHTML = `<div class="col-span-full text-white/40 py-8 text-center">
            <i class="fa fa-inbox text-3xl mb-2 block"></i>
            暂无插件，请将插件 .py 文件放入 backend/plugins/ 目录后热加载
        </div>`;
        return;
    }

    container.innerHTML = _allPlugins.map(p => {
        const typeBadge = p.interruptible
            ? `<span class="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 ml-1 font-mono">拦截型</span>`
            : `<span class="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 ml-1 font-mono">监听型</span>`;
        return `
        <div class="bg-white/5 border border-white/10 rounded-xl p-4 hover:border-primary/50 transition-colors">
            <div class="flex items-start justify-between mb-2 gap-2 flex-wrap">
                <span class="font-bold text-white truncate">${escHtml(p.name)}</span>
                <div class="flex items-center gap-1 shrink-0">
                    <span class="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary font-mono">${escHtml(p.type)}</span>
                    ${typeBadge}
                </div>
            </div>
            <p class="text-white/50 text-sm mb-2 line-clamp-2" title="${escHtml(p.description)}">${escHtml(p.description)}</p>
            <span class="text-white/30 text-xs">v${escHtml(p.version)}</span>
        </div>`;
    }).join('');
}

// ── 加载事件绑定 ──────────────────────────────────────────────────────
async function loadEventBindings() {
    try {
        const [evtRes, bindRes] = await Promise.all([
            apiGet('/index/pyapi/plugin/events'),
            apiGet('/index/pyapi/plugin/bindings'),
        ]);
        _allEvents = evtRes.data || [];
        _bindings  = bindRes.data || [];
        renderEventBindings();
    } catch (e) {
        document.getElementById('eventBindingsTable').innerHTML =
            `<tr><td colspan="3" class="text-red-400 p-6 text-center">${e.message}</td></tr>`;
    }
}

function renderEventBindings() {
    const tbody = document.getElementById('eventBindingsTable');
    if (!_bindings.length) {
        tbody.innerHTML = `<tr><td colspan="3" class="text-white/40 p-8 text-center">暂无数据</td></tr>`;
        return;
    }

    tbody.innerHTML = _bindings.map(row => {
        const bindings = row.bindings || [];
        const hasBind  = bindings.length > 0;

        const pills = hasBind
            ? bindings.map(b => {
                const plugin = _allPlugins.find(p => p.name === b.plugin_name);
                const typeTag = plugin
                    ? (plugin.interruptible
                        ? `<i class="fa fa-bolt text-red-400 ml-1 text-[10px]" title="拦截型：消费后终止后续插件"></i>`
                        : `<i class="fa fa-eye text-green-400 ml-1 text-[10px]" title="监听型：不阻断后续插件"></i>`)
                    : '';
                const hasParams = b.params && Object.keys(b.params).length > 0;
                const paramTag  = hasParams
                    ? `<i class="fa fa-cog text-yellow-400 ml-1 text-[10px]" title="已配置参数"></i>`
                    : '';
                const hitCount  = b.hit_count || 0;
                const hitTag    = hitCount > 0
                    ? `<span class="ml-1 text-[10px] text-white/40" title="命中次数">${hitCount}</span>`
                    : '';
                const enabledCls = b.enabled ? 'bg-primary/20 text-primary' : 'bg-white/10 text-white/40 line-through';
                return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-mono mr-1 mb-1 ${enabledCls}">
                    ${escHtml(b.plugin_name)}${typeTag}${paramTag}${hitTag}
                </span>`;
              }).join('')
            : `<span class="text-white/30 text-sm italic">未绑定</span>`;

        return `
        <tr class="border-b border-white/5 hover:bg-white/5 transition-colors">
            <td class="py-3 px-4 font-mono text-sm text-white/80">${escHtml(row.event_type)}</td>
            <td class="py-3 px-4 leading-loose">${pills}</td>
            <td class="py-3 px-4 whitespace-nowrap">
                <button onclick="openBindingModal('${escHtml(row.event_type)}')"
                    class="text-primary hover:text-white text-sm transition-colors mr-3">
                    <i class="fa fa-pencil mr-1"></i>编辑
                </button>
                ${hasBind ? `<button onclick="clearBinding('${escHtml(row.event_type)}')"
                    class="text-red-400 hover:text-white text-sm transition-colors">
                    <i class="fa fa-trash mr-1"></i>清除
                </button>` : ''}
            </td>
        </tr>`;
    }).join('');
}

// ── 热加载插件 ────────────────────────────────────────────────────────
async function reloadPlugins() {
    const btn = document.getElementById('reloadPluginsBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa fa-spinner fa-spin mr-2"></i>加载中...';
    try {
        const res = await apiPost('/index/pyapi/plugin/reload', {});
        if (res.code === 0) {
            showToast(res.msg, 'success');
            await loadPluginList();
            await loadEventBindings();
        } else {
            showToast(res.msg || '热加载失败', 'error');
        }
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa fa-refresh mr-2"></i>热加载插件';
    }
}

// ── 编辑绑定弹窗 ───────────────────────────────────────────────────────
function openBindingModal(eventType) {
    _editEvent        = eventType;
    _editParams       = {};
    _selectedBindings = [];

    document.getElementById('modalEventType').textContent = eventType;

    const row      = _bindings.find(b => b.event_type === eventType) || {};
    const curBinds = row.bindings || [];
    const enabled  = curBinds.some(b => b.enabled) || curBinds.length === 0;
    document.getElementById('bindingEnabled').checked = enabled;

    // 构建已绑定列表数据并初始化参数
    const matched = _allPlugins.filter(p => p.type === eventType);
    curBinds.forEach((b, i) => {
        const plugin = matched.find(p => p.name === b.plugin_name);
        if (!plugin) return;
        const paramKey = plugin.multi_binding ? `${b.plugin_name}#${i}` : b.plugin_name;
        _editParams[paramKey] = Object.assign({}, b.params || {});
        _selectedBindings.push({ pluginName: b.plugin_name, paramKey });
    });

    _renderBindingLists();
    document.getElementById('bindingModal').classList.remove('hidden');
}

function closeBindingModal() {
    document.getElementById('bindingModal').classList.add('hidden');
    _editEvent = null;
}

// ── 渲染两个列表（数据驱动）─────────────────────────────────────────
function _renderBindingLists() {
    _renderSelectedList();
    _renderAvailableList();
}

function _renderSelectedList() {
    const container = document.getElementById('selectedPlugins');
    if (!_selectedBindings.length) {
        container.innerHTML = `<div class="text-white/30 text-xs text-center py-3 select-none" data-hint="1">（拖入插件以绑定）</div>`;
        return;
    }
    // 统计每个插件出现次数，用于显示序号
    const nameCounters = {};
    container.innerHTML = _selectedBindings.map((item, idx) => {
        const p = _allPlugins.find(pl => pl.name === item.pluginName);
        if (!p) return '';
        const typeBadge = p.interruptible
            ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">拦截</span>`
            : `<span class="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">监听</span>`;
        nameCounters[p.name] = (nameCounters[p.name] || 0) + 1;
        const idxBadge = p.multi_binding
            ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/50 font-mono">#${nameCounters[p.name]}</span>`
            : '';
        return `
        <div class="flex items-center gap-2 bg-white/10 rounded-lg px-3 py-2 cursor-grab select-none hover:bg-primary/20 transition-colors"
            draggable="true"
            data-sel-idx="${idx}"
            ondragstart="_selDragStart(event, ${idx})"
            ondragover="event.preventDefault()"
            ondrop="_selDrop(event, ${idx})"
            ondblclick="_removeSelected(${idx})">
            <i class="fa fa-grip-vertical text-white/30 text-xs shrink-0"></i>
            <span class="font-mono text-sm text-white font-semibold">${escHtml(p.name)}</span>
            ${idxBadge}${typeBadge}
            <span class="text-white/40 text-xs truncate max-w-[120px]" title="${escHtml(p.description)}">${escHtml(p.description)}</span>
            <button type="button" onclick="openParamsModal('${escHtml(item.paramKey)}')"
                class="ml-auto shrink-0 text-yellow-400/70 hover:text-yellow-400 transition-colors text-xs" title="编辑绑定参数">
                <i class="fa fa-cog mr-1"></i>参数
            </button>
            <button type="button" onclick="_removeSelected(${idx})"
                class="shrink-0 text-white/30 hover:text-red-400 transition-colors text-xs" title="移除">
                <i class="fa fa-times"></i>
            </button>
        </div>`;
    }).join('');
}

function _renderAvailableList() {
    const container = document.getElementById('availablePlugins');
    if (!_editEvent) return;
    const matched = _allPlugins.filter(p => p.type === _editEvent);
    // 非 multi_binding 已绑定的排除
    const boundNames = new Set(_selectedBindings
        .filter(b => {
            const p = _allPlugins.find(pl => pl.name === b.pluginName);
            return p && !p.multi_binding;
        })
        .map(b => b.pluginName));
    const available = matched.filter(p => !boundNames.has(p.name));

    if (!available.length) {
        container.innerHTML = `<div class="text-white/30 text-xs text-center py-3 select-none" data-hint="1">（无可用插件）</div>`;
        return;
    }
    container.innerHTML = available.map(p => {
        const typeBadge = p.interruptible
            ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">拦截</span>`
            : `<span class="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">监听</span>`;
        const multiBadge = p.multi_binding
            ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400">可多绑</span>`
            : '';
        return `
        <div class="flex items-center gap-2 bg-white/5 border border-dashed border-white/10 rounded-lg px-3 py-2 cursor-grab select-none hover:bg-white/10 transition-colors"
            draggable="true"
            data-plugin-name="${escHtml(p.name)}"
            ondragstart="_availDragStart(event, '${escHtml(p.name)}')"
            ondblclick="_addPlugin('${escHtml(p.name)}')">
            <i class="fa fa-grip-vertical text-white/30 text-xs shrink-0"></i>
            <span class="font-mono text-sm text-white font-semibold">${escHtml(p.name)}</span>
            ${typeBadge}${multiBadge}
            <span class="text-white/40 text-xs truncate max-w-[140px]" title="${escHtml(p.description)}">${escHtml(p.description)}</span>
        </div>`;
    }).join('');
}

// ── 添加插件到已绑定 ──────────────────────────────────────────────────
function _addPlugin(pluginName) {
    const plugin = _allPlugins.find(p => p.name === pluginName);
    if (!plugin) return;
    // 非 multi_binding 检查重复
    if (!plugin.multi_binding && _selectedBindings.some(b => b.pluginName === pluginName)) {
        showToast(`插件 "${pluginName}" 不支持多次绑定`, 'warning');
        return;
    }
    // 生成 paramKey
    const count = _selectedBindings.filter(b => b.pluginName === pluginName).length;
    const paramKey = plugin.multi_binding ? `${pluginName}#${count}` : pluginName;
    if (!_editParams[paramKey]) {
        // 用 schema 默认值初始化
        const schema = plugin.params_schema || {};
        _editParams[paramKey] = {};
        Object.entries(schema).forEach(([k, def]) => {
            _editParams[paramKey][k] = def.default ?? (def.type === 'protocol_option' ? {} : def.type === 'bool' ? true : '');
        });
    }
    _selectedBindings.push({ pluginName, paramKey });
    _renderBindingLists();
}

// ── 从已绑定移除 ──────────────────────────────────────────────────────
function _removeSelected(idx) {
    _selectedBindings.splice(idx, 1);
    _renderBindingLists();
}

// ── 已绑定列表拖拽排序 ────────────────────────────────────────────────
let _selDragIdx = null;
function _selDragStart(e, idx) {
    _selDragIdx = idx;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
}
function _selDrop(e, targetIdx) {
    e.preventDefault();
    if (_selDragIdx === null || _selDragIdx === targetIdx) return;
    const item = _selectedBindings.splice(_selDragIdx, 1)[0];
    _selectedBindings.splice(targetIdx, 0, item);
    _selDragIdx = null;
    _renderSelectedList();
}

// ── 可用列表拖入已绑定区域 ────────────────────────────────────────────
let _availDragName = null;
function _availDragStart(e, pluginName) {
    _availDragName = pluginName;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', pluginName);
}

function dropPlugin(e, targetArea) {
    e.preventDefault();
    if (targetArea === 'selected') {
        if (_availDragName) {
            _addPlugin(_availDragName);
            _availDragName = null;
        } else if (_selDragIdx !== null) {
            // 已绑定区域内部排序在 _selDrop 处理，这里忽略
            _selDragIdx = null;
        }
    }
    // 拖到 available 区域不处理
}

// ── 保留旧的 renderDragList（兼容，但不再用于选中列表）──────────────
function renderDragList(containerId, plugins, showParamsBtn) {
    // 仅用于可用列表的初始渲染，现已由 _renderAvailableList 替代，保留空实现防报错
}

function renderSelectedList() {
    // 由 _renderSelectedList 替代，保留空实现
}

// ── 以下旧函数保留空实现，防止其他地方调用报错 ────────────────────────
function togglePluginBinding() {}
function _addToSelected() {}
function _refreshEmptyHint() {}
function _refreshSelectedBadges() {}
function dragStart(e) { e.currentTarget.classList.add('opacity-50'); }
function dragEnd(e)   { e.currentTarget.classList.remove('opacity-50'); }

// ── 保存绑定 ──────────────────────────────────────────────────────────
async function saveBinding() {
    if (!_editEvent) return;
    const enabled = document.getElementById('bindingEnabled').checked ? 1 : 0;
    const bindings = _selectedBindings.map(item => ({
        plugin_name: item.pluginName,
        params: _editParams[item.paramKey] || {},
    }));

    try {
        const res = await apiPost('/index/pyapi/plugin/bindings/save', {
            event_type: _editEvent,
            bindings,
            enabled,
        });
        if
 (res.code === 0) {
            showToast('保存成功', 'success');
            closeBindingModal();
            await loadEventBindings();
        } else {
            showToast(res.msg || '保存失败', 'error');
        }
    } catch (e) {
        showToast(e.message, 'error');
    }
}

// ── 清除绑定 ──────────────────────────────────────────────────────────
async function clearBinding(eventType) {
    showConfirmModal(
        '清除插件绑定',
        `确定清除 <span class="text-primary font-mono">${eventType}</span> 的所有插件绑定？`,
        async () => {
            try {
                const res = await apiPost('/index/pyapi/plugin/bindings/delete', { event_type: eventType });
                if (res.code === 0) {
                    showToast('已清除', 'success');
                    await loadEventBindings();
                } else {
                    showToast(res.msg || '清除失败', 'error');
                }
            } catch (e) {
                showToast(e.message, 'error');
            }
        }
    );
}

// ── 参数编辑弹窗 ───────────────────────────────────────────────────────
// 缓存协议配置列表
let _protocolOptionsList = null;

async function _loadProtocolOptionsList() {
    if (_protocolOptionsList) return _protocolOptionsList;
    try {
        const res = await apiGet('/index/pyapi/get_protocol_options_list');
        _protocolOptionsList = res.data || res.options || [];
    } catch (e) {
        _protocolOptionsList = [];
    }
    return _protocolOptionsList;
}

// protocol_option 字段分组（与协议预设界面保持一致）
const _PROTO_GROUPS = [
    {
        title: '通用配置',
        cols: 2,
        fields: [
            { key: 'modify_stamp',    id: 'po_modify_stamp',    label: '时间戳覆盖(modify_stamp)',        type: 'select', opts: [['0','0-绝对'],['1','1-系统'],['2','2-相对']] },
            { key: 'enable_audio',    id: 'po_enable_audio',    label: '开启音频(enable_audio)',          type: 'select', opts: [['1','1-开启'],['0','0-关闭']] },
            { key: 'add_mute_audio',  id: 'po_add_mute_audio',  label: '添加静音音频(add_mute_audio)',    type: 'select', opts: [['1','1-开启'],['0','0-关闭']] },
            { key: 'auto_close',      id: 'po_auto_close',      label: '自动关闭(auto_close)',            type: 'select', opts: [['1','1-开启'],['0','0-关闭']] },
            { key: 'paced_sender_ms', id: 'po_paced_sender_ms', label: '平滑发送间隔ms(paced_sender_ms)', type: 'number' },
        ],
    },
    {
        title: '转协议开关',
        cols: 3,
        fields: [
            { key: 'enable_hls',      id: 'po_enable_hls',      label: '开启HLS(enable_hls)',            type: 'select', opts: [['1','1-开启'],['0','0-关闭']] },
            { key: 'enable_hls_fmp4', id: 'po_enable_hls_fmp4', label: '开启HLS-FMP4(enable_hls_fmp4)',  type: 'select', opts: [['1','1-开启'],['0','0-关闭']] },
            { key: 'enable_mp4',      id: 'po_enable_mp4',      label: '开启MP4录制(enable_mp4)',         type: 'select', opts: [['1','1-开启'],['0','0-关闭']] },
            { key: 'enable_rtsp',     id: 'po_enable_rtsp',     label: '开启RTSP(enable_rtsp)',           type: 'select', opts: [['1','1-开启'],['0','0-关闭']] },
            { key: 'enable_rtmp',     id: 'po_enable_rtmp',     label: '开启RTMP/FLV(enable_rtmp)',       type: 'select', opts: [['1','1-开启'],['0','0-关闭']] },
            { key: 'enable_ts',       id: 'po_enable_ts',       label: '开启HTTP-TS(enable_ts)',          type: 'select', opts: [['1','1-开启'],['0','0-关闭']] },
            { key: 'enable_fmp4',     id: 'po_enable_fmp4',     label: '开启FMP4(enable_fmp4)',           type: 'select', opts: [['1','1-开启'],['0','0-关闭']] },
        ],
    },
    {
        title: '按需转协议开关',
        cols: 3,
        fields: [
            { key: 'hls_demand',  id: 'po_hls_demand',  label: 'HLS按需(hls_demand)',   type: 'select', opts: [['1','1-开启'],['0','0-关闭']] },
            { key: 'rtsp_demand', id: 'po_rtsp_demand', label: 'RTSP按需(rtsp_demand)',  type: 'select', opts: [['1','1-开启'],['0','0-关闭']] },
            { key: 'rtmp_demand', id: 'po_rtmp_demand', label: 'RTMP按需(rtmp_demand)',  type: 'select', opts: [['1','1-开启'],['0','0-关闭']] },
            { key: 'ts_demand',   id: 'po_ts_demand',   label: 'TS按需(ts_demand)',      type: 'select', opts: [['1','1-开启'],['0','0-关闭']] },
            { key: 'fmp4_demand', id: 'po_fmp4_demand', label: 'FMP4按需(fmp4_demand)',  type: 'select', opts: [['1','1-开启'],['0','0-关闭']] },
        ],
    },
    {
        title: '录制配置',
        cols: 2,
        fields: [
            { key: 'mp4_as_player',  id: 'po_mp4_as_player',  label: 'MP4计入观看数(mp4_as_player)', type: 'select', opts: [['1','1-开启'],['0','0-关闭']] },
            { key: 'mp4_max_second', id: 'po_mp4_max_second', label: 'MP4切片大小s(mp4_max_second)',  type: 'number' },
            { key: 'mp4_save_path',  id: 'po_mp4_save_path',  label: 'MP4保存路径(mp4_save_path)',    type: 'text'   },
            { key: 'hls_save_path',  id: 'po_hls_save_path',  label: 'HLS保存路径(hls_save_path)',    type: 'text'   },
        ],
    },
];
// 扁平化字段列表（供读值/遍历使用）
const _PROTO_FIELDS = _PROTO_GROUPS.flatMap(g => g.fields);

// 从协议配置表单 DOM 读取当前值（只收集非空字段）
function _readProtoFormValues() {
    const result = {};
    _PROTO_FIELDS.forEach(f => {
        const el = document.getElementById(f.id);
        if (el && el.value !== '') result[f.key] = el.value;
    });
    return result;
}

// 渲染 protocol_option 内嵌表单（分组布局，与协议预设界面一致）
function _renderProtoOptionForm(paramKey, currentVal) {
    const cur = (currentVal && typeof currentVal === 'object') ? currentVal : {};
    const sel = (k, v) => cur[k] !== undefined && String(cur[k]) === v ? 'selected' : '';
    const selEmpty = k => cur[k] === undefined || cur[k] === '' ? 'selected' : '';
    const inCls = 'w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white text-xs focus:outline-none focus:border-primary/50';
    const pk = escHtml(paramKey);

    const makeSelect = (f) => `
        <select id="${f.id}" class="${inCls}" style="color:white;" onchange="_syncProtoForm('${pk}')">
            <option value="" ${selEmpty(f.key)}>默认</option>
            ${f.opts.map(([v, l]) => `<option value="${v}" ${sel(f.key, v)}>${l}</option>`).join('')}
        </select>`;
    const makeInput = (f) => `
        <input type="${f.type}" id="${f.id}" value="${escHtml(String(cur[f.key] ?? ''))}" placeholder="默认"
            class="${inCls}" oninput="_syncProtoForm('${pk}')">`;

    const groupsHtml = _PROTO_GROUPS.map(g => {
        const colCls = `grid grid-cols-${g.cols} gap-2`;
        const fieldsHtml = g.fields.map(f => `
            <div>
                <label class="block text-white/60 text-[11px] mb-0.5">${f.label}</label>
                ${f.type === 'select' ? makeSelect(f) : makeInput(f)}
            </div>`).join('');
        return `
        <div class="bg-white/5 rounded-lg p-3">
            <div class="text-white/70 text-xs font-semibold mb-2 border-b border-white/10 pb-1">${g.title}</div>
            <div class="${colCls}">${fieldsHtml}</div>
        </div>`;
    }).join('');

    return `
    <div class="mt-2 border border-white/10 rounded-lg overflow-hidden">
        <!-- 工具栏 -->
        <div class="flex gap-2 px-3 py-2 bg-white/5 border-b border-white/10">
            <button type="button" onclick="_poLoadDefault('${pk}')"
                class="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white/80 transition-colors">
                <i class="fa fa-magic mr-1"></i>加载默认
            </button>
            <button type="button" onclick="_poLoadPreset('${pk}')"
                class="text-xs px-2 py-1 rounded bg-primary/30 hover:bg-primary/50 text-white transition-colors">
                <i class="fa fa-list mr-1"></i>从预设加载
            </button>
            <button type="button" onclick="_poClear('${pk}')"
                class="text-xs px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-400 transition-colors">
                <i class="fa fa-eraser mr-1"></i>清空
            </button>
        </div>
        <!-- 分组内容 -->
        <div class="space-y-2 p-3">${groupsHtml}</div>
    </div>`;
}

// 表单任意字段变化后同步回 _editParams
function _syncProtoForm(paramKey) {
    if (!_editParams[_paramsPlugin]) _editParams[_paramsPlugin] = {};
    _editParams[_paramsPlugin][paramKey] = _readProtoFormValues();
}

// 加载默认（从服务器 protocol.* 配置）
async function _poLoadDefault(paramKey) {
    try {
        const result = await Api.getServerConfig();
        if (result.code === 0 && result.data && result.data.length > 0) {
            const cfg = result.data[0] || {};
            _PROTO_FIELDS.forEach(f => {
                const el = document.getElementById(f.id);
                const v = cfg[`protocol.${f.key}`];
                if (el && v !== undefined && v !== null) el.value = String(v);
            });
            _syncProtoForm(paramKey);
            showToast('已加载服务器默认协议配置', 'success');
        } else {
            showToast('获取服务器配置失败', 'error');
        }
    } catch (e) {
        showToast('加载失败: ' + e.message, 'error');
    }
}

// 从预设加载
async function _poLoadPreset(paramKey) {
    const list = await _loadProtocolOptionsList();
    if (!list || !list.length) {
        showToast('暂无可用预设，请先在「协议配置」中添加', 'warning');
        return;
    }
    // 弹出预设选择器
    let picker = document.getElementById('_poPresetPicker');
    if (picker) picker.remove();
    picker = document.createElement('div');
    picker.id = '_poPresetPicker';
    picker.className = 'fixed inset-0 bg-black/70 flex items-center justify-center z-[60]';
    picker.innerHTML = `
        <div class="bg-gray-900 rounded-xl p-6 max-w-sm w-full mx-4 border border-white/20" onclick="event.stopPropagation()">
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-base font-bold text-white">选择协议预设</h3>
                <button onclick="document.getElementById('_poPresetPicker').remove()" class="text-white/50 hover:text-white text-xl leading-none">&times;</button>
            </div>
            <select id="_poPresetSelect" class="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm mb-4 focus:outline-none">
                <option value="">-- 请选择预设 --</option>
                ${list.map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('')}
            </select>
            <div class="flex justify-end gap-3">
                <button onclick="document.getElementById('_poPresetPicker').remove()"
                    class="px-4 py-2 rounded-lg bg-white/10 text-white text-sm hover:bg-white/20 transition-colors">取消</button>
                <button onclick="_poApplyPreset('${escHtml(paramKey)}')"
                    class="px-4 py-2 rounded-lg bg-primary text-white text-sm hover:bg-primary/80 transition-colors">确定</button>
            </div>
        </div>`;
    picker.addEventListener('click', e => { if (e.target === picker) picker.remove(); });
    document.body.appendChild(picker);
}

async function _poApplyPreset(paramKey) {
    const sel = document.getElementById('_poPresetSelect');
    if (!sel || !sel.value) { showToast('请先选择一个预设', 'warning'); return; }
    try {
        const res = await apiGet(`/index/pyapi/get_protocol_options?id=${sel.value}`);
        const p = res.data || res;
        if (!p) { showToast('获取预设详情失败', 'error'); return; }
        _PROTO_FIELDS.forEach(f => {
            const el = document.getElementById(f.id);
            if (el && p[f.key] !== undefined && p[f.key] !== null) el.value = String(p[f.key]);
        });
        _syncProtoForm(paramKey);
        document.getElementById('_poPresetPicker')?.remove();
        showToast('已从预设加载协议配置', 'success');
    } catch (e) {
        showToast('加载失败: ' + e.message, 'error');
    }
}

// 清空所有字段
function _poClear(paramKey) {
    _PROTO_FIELDS.forEach(f => {
        const el = document.getElementById(f.id);
        if (el) el.value = '';
    });
    _syncProtoForm(paramKey);
    showToast('协议配置已清空', 'info');
}

async function openParamsModal(paramKey) {
    _paramsPlugin = paramKey;  // 用 paramKey 作为内部标识（可能含 #N）
    _paramsEvent  = _editEvent;
    // 显示时去掉 #N 后缀只展示插件名
    const pluginName = paramKey.includes('#') ? paramKey.split('#')[0] : paramKey;
    const instanceNum = paramKey.includes('#') ? parseInt(paramKey.split('#')[1]) + 1 : null;
    const displayName = instanceNum ? `${pluginName} <span class="text-white/40 font-normal text-sm">#${instanceNum}</span>` : pluginName;
    document.getElementById('paramsPluginName').innerHTML = displayName;
    document.getElementById('paramsEventType').textContent  = _editEvent || '';

    const plugin = _allPlugins.find(p => p.name === pluginName);
    const schema = plugin?.params_schema || {};
    if (!_editParams[paramKey]) _editParams[paramKey] = {};
    Object.entries(schema).forEach(([k, def]) => {
        if (!_editParams[paramKey].hasOwnProperty(k)) {
            _editParams[paramKey][k] = def.default ?? (def.type === 'protocol_option' ? {} : def.type === 'bool' ? true : '');
        }
    });

    // 有 protocol_option 字段时预加载预设列表
    const hasProtoOpt = Object.values(schema).some(d => d.type === 'protocol_option');
    if (hasProtoOpt) await _loadProtocolOptionsList();

    renderParamsList();
    document.getElementById('paramsModal').classList.remove('hidden');
}

function closeParamsModal() {
    document.getElementById('paramsModal').classList.add('hidden');
    _paramsPlugin = null;
}

function renderParamsList() {
    const params    = _editParams[_paramsPlugin] || {};
    const container = document.getElementById('paramsList');
    // _paramsPlugin 可能是 name#N，取真实插件名
    const pluginName = _paramsPlugin.includes('#') ? _paramsPlugin.split('#')[0] : _paramsPlugin;
    const plugin    = _allPlugins.find(p => p.name === pluginName);
    const schema    = plugin?.params_schema || {};
    const keys      = Object.keys(schema);

    if (!keys.length) {
        container.innerHTML = `<div class="text-white/30 text-sm text-center py-4">此插件无可配置参数</div>`;
        return;
    }

    container.innerHTML = keys.map(k => {
        const def  = schema[k] || {};
        const val  = params.hasOwnProperty(k) ? params[k] : (def.default ?? '');
        const typeHint = def.type ? `<span class="text-white/20 text-[10px] ml-1">${escHtml(def.type)}</span>` : '';
        const desc = def.description
            ? `<div class="text-white/35 text-[11px] mt-0.5 leading-tight">${escHtml(def.description)}</div>`
            : '';

        let inputEl = '';
        if (def.type === 'protocol_option') {
            inputEl = _renderProtoOptionForm(k, val);
        } else if (def.type === 'bool') {
            const checked = (val === true || val === 'true' || val === 1 || val === '1') ? 'checked' : '';
            inputEl = `
            <div class="flex items-center gap-3 mt-1.5">
                <label class="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" id="param_bool_${escHtml(k)}" ${checked}
                        class="sr-only peer"
                        onchange="updateParamValue('${escHtml(k)}', this.checked)">
                    <div class="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer
                        peer-checked:after:translate-x-full peer-checked:after:border-white
                        after:content-[''] after:absolute after:top-[2px] after:left-[2px]
                        after:bg-white after:border-gray-300 after:border after:rounded-full
                        after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                </label>
                <span class="text-white/60 text-xs" id="param_bool_label_${escHtml(k)}">${val === true || val === 'true' || val === 1 ? '开启' : '关闭'}</span>
            </div>`;
        } else {
            inputEl = `
            <input type="${def.type === 'int' ? 'number' : 'text'}"
                value="${escHtml(String(val ?? ''))}"
                class="w-full mt-1.5 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white text-sm
                    focus:outline-none focus:border-primary/50"
                onchange="updateParamValue('${escHtml(k)}', this.value)">`;
        }

        return `
        <div class="bg-white/5 border border-white/10 rounded-lg px-3 py-2">
            <div class="flex items-center gap-1 mb-1">
                <span class="font-mono text-sm text-primary font-semibold">${escHtml(k)}</span>${typeHint}
            </div>
            ${desc}
            ${inputEl}
        </div>`;
    }).join('');
}

function updateParamValue(key, value) {
    if (!_editParams[_paramsPlugin]) _editParams[_paramsPlugin] = {};
    // bool 类型保存为 boolean
    const pluginName = _paramsPlugin.includes('#') ? _paramsPlugin.split('#')[0] : _paramsPlugin;
    const plugin = _allPlugins.find(p => p.name === pluginName);
    const schema = plugin?.params_schema || {};
    if (schema[key]?.type === 'bool') {
        _editParams[_paramsPlugin][key] = !!value;
        const lbl = document.getElementById(`param_bool_label_${key}`);
        if (lbl) lbl.textContent = value ? '开启' : '关闭';
    } else {
        _editParams[_paramsPlugin][key] = value;
    }
}

function saveParams() {
    showToast('参数已更新（保存绑定后生效）', 'success');
    closeParamsModal();
}

// ── 工具 ──────────────────────────────────────────────────────────────
function escHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
