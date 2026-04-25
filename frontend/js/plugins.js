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
// 编辑绑定弹窗中每个已选插件的临时 params（key = plugin_name）
let _editParams   = {};
// 参数弹窗状态
let _paramsPlugin = null; // 当前编辑参数的 plugin_name

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
            <p class="text-white/50 text-sm mb-2 line-clamp-2">${escHtml(p.description)}</p>
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
                const enabledCls = b.enabled ? 'bg-primary/20 text-primary' : 'bg-white/10 text-white/40 line-through';
                return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-mono mr-1 mb-1 ${enabledCls}">
                    ${escHtml(b.plugin_name)}${typeTag}${paramTag}
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
    _editEvent  = eventType;
    _editParams = {};

    document.getElementById('modalEventType').textContent = eventType;

    // 当前绑定
    const row      = _bindings.find(b => b.event_type === eventType) || {};
    const curBinds = row.bindings || [];
    const enabled  = curBinds.some(b => b.enabled) || curBinds.length === 0;
    document.getElementById('bindingEnabled').checked = enabled;

    // 初始化临时参数
    curBinds.forEach(b => { _editParams[b.plugin_name] = Object.assign({}, b.params || {}); });

    // 过滤类型匹配的插件
    const matched   = _allPlugins.filter(p => p.type === eventType);
    const selNames  = curBinds.map(b => b.plugin_name);
    const selected  = selNames.map(n => matched.find(p => p.name === n)).filter(Boolean);
    const available = matched.filter(p => !selNames.includes(p.name));

    renderDragList('selectedPlugins', selected, true);
    renderDragList('availablePlugins', available, false);

    document.getElementById('bindingModal').classList.remove('hidden');
}

function closeBindingModal() {
    document.getElementById('bindingModal').classList.add('hidden');
    _editEvent = null;
}

function renderDragList(containerId, plugins, showParamsBtn) {
    const el = document.getElementById(containerId);
    if (!plugins.length) {
        el.innerHTML = `<div class="text-white/30 text-xs text-center py-2 select-none pointer-events-none">
            ${containerId === 'selectedPlugins' ? '（拖入插件以绑定）' : '（无可用插件）'}
        </div>`;
        return;
    }
    el.innerHTML = plugins.map(p => {
        const typeBadge = p.interruptible !== undefined
            ? (p.interruptible
                ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">拦截</span>`
                : `<span class="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">监听</span>`)
            : '';
        const paramsBtn = showParamsBtn
            ? `<button type="button" onclick="openParamsModal('${escHtml(p.name)}')"
                class="ml-auto shrink-0 text-yellow-400/70 hover:text-yellow-400 transition-colors text-xs"
                title="编辑绑定参数">
                <i class="fa fa-cog mr-1"></i>参数
               </button>`
            : '';
        return `
        <div class="flex items-center gap-2 bg-white/10 rounded-lg px-3 py-2 cursor-grab select-none
            hover:bg-primary/20 transition-colors"
            draggable="true"
            data-plugin-name="${escHtml(p.name)}"
            data-plugin-type="${escHtml(p.type)}"
            data-plugin-interruptible="${p.interruptible ? 'true' : 'false'}"
            ondragstart="dragStart(event)"
            ondragend="dragEnd(event)"
            ondblclick="togglePluginBinding(this)">
            <i class="fa fa-grip-vertical text-white/30 text-xs shrink-0"></i>
            <span class="font-mono text-sm text-white font-semibold">${escHtml(p.name)}</span>
            ${typeBadge}
            <span class="text-white/40 text-xs truncate max-w-[140px]">${escHtml(p.description)}</span>
            ${paramsBtn}
        </div>`;
    }).join('');
}

// ── 双击切换绑定/解绑 ─────────────────────────────────────────────────
function togglePluginBinding(el) {
    const srcContainer = el.parentElement;
    const isSelected   = srcContainer.id === 'selectedPlugins';
    const targetId     = isSelected ? 'availablePlugins' : 'selectedPlugins';
    const target       = document.getElementById(targetId);

    srcContainer.removeChild(el);
    _refreshEmptyHint(srcContainer);

    if (targetId === 'selectedPlugins') {
        _addToSelected(el, target);
    } else {
        // 移回未绑定：移除参数按钮
        const btn = el.querySelector('button');
        if (btn) btn.remove();
        const placeholder = target.querySelector('.pointer-events-none');
        if (placeholder) placeholder.remove();
        target.appendChild(el);
    }
}

// ── 将插件元素加入"已绑定"列表 ──────────────────────────────────────
function _addToSelected(el, selectedContainer) {
    // 清除占位提示
    const placeholder = selectedContainer.querySelector('.pointer-events-none');
    if (placeholder) placeholder.remove();

    // 追加"参数"按钮
    if (!el.querySelector('button[data-params-btn]')) {
        const pName = el.dataset.pluginName;
        const btn   = document.createElement('button');
        btn.type      = 'button';
        btn.dataset.paramsBtn = '1';
        btn.className = 'ml-auto shrink-0 text-yellow-400/70 hover:text-yellow-400 transition-colors text-xs';
        btn.title     = '编辑绑定参数';
        btn.innerHTML = '<i class="fa fa-cog mr-1"></i>参数';
        btn.setAttribute('onclick', `openParamsModal('${pName}')`);
        el.appendChild(btn);
    }

    selectedContainer.appendChild(el);
    _refreshEmptyHint(document.getElementById('availablePlugins'));
}

// ── 拖拽排序 ──────────────────────────────────────────────────────────
function dragStart(e) {
    _dragSource = e.currentTarget;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', e.currentTarget.dataset.pluginName);
    e.currentTarget.classList.add('opacity-50');
}
function dragEnd(e) {
    e.currentTarget.classList.remove('opacity-50');
    _dragSource = null;
}
function dropPlugin(e, targetArea) {
    e.preventDefault();
    if (!_dragSource) return;

    const targetContainerId = targetArea === 'selected' ? 'selectedPlugins' : 'availablePlugins';
    const targetContainer   = document.getElementById(targetContainerId);
    const srcContainer      = _dragSource.parentElement;
    const isReorder         = srcContainer.id === targetContainerId;

    if (isReorder) {
        const overEl = e.target.closest('[data-plugin-name]');
        if (overEl && overEl !== _dragSource) {
            targetContainer.insertBefore(_dragSource, overEl);
        }
    } else {
        if (srcContainer && _dragSource.dataset.pluginName) {
            srcContainer.removeChild(_dragSource);
            _refreshEmptyHint(srcContainer);
        }

        // 移入 selectedPlugins 时走统一的独占清场逻辑
        if (targetContainerId === 'selectedPlugins') {
            _addToSelected(_dragSource, targetContainer);
        } else {
            // 移回 availablePlugins 时移除参数按钮
            const btn = _dragSource.querySelector('button[data-params-btn]');
            if (btn) btn.remove();
            const placeholder = targetContainer.querySelector('.pointer-events-none');
            if (placeholder) placeholder.remove();
            targetContainer.appendChild(_dragSource);
        }
    }
}
function _refreshEmptyHint(container) {
    // 先清除已有的占位提示，避免重复追加
    container.querySelectorAll('.pointer-events-none').forEach(el => el.remove());
    const items = container.querySelectorAll('[data-plugin-name]');
    if (!items.length) {
        const hint     = document.createElement('div');
        hint.className = 'text-white/30 text-xs text-center py-2 select-none pointer-events-none';
        hint.textContent = container.id === 'selectedPlugins' ? '（拖入插件以绑定）' : '（无可用插件）';
        container.appendChild(hint);
    }
}

// ── 保存绑定 ──────────────────────────────────────────────────────────
async function saveBinding() {
    if (!_editEvent) return;

    const selectedEls = document.getElementById('selectedPlugins')
        .querySelectorAll('[data-plugin-name]');
    const enabled = document.getElementById('bindingEnabled').checked ? 1 : 0;

    const bindings = Array.from(selectedEls).map(el => ({
        plugin_name: el.dataset.pluginName,
        params: _editParams[el.dataset.pluginName] || {},
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
    if (!confirm(`确定清除 "${eventType}" 的所有插件绑定？`)) return;
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

// ── 参数编辑弹窗 ───────────────────────────────────────────────────────
function openParamsModal(pluginName) {
    _paramsPlugin = pluginName;
    _paramsEvent  = _editEvent;
    document.getElementById('paramsPluginName').textContent = pluginName;
    document.getElementById('paramsEventType').textContent  = _editEvent || '';

    // 用 schema 默认值初始化（仅当该 key 尚未设置时）
    const plugin = _allPlugins.find(p => p.name === pluginName);
    const schema = plugin?.params_schema || {};
    if (!_editParams[pluginName]) _editParams[pluginName] = {};
    Object.entries(schema).forEach(([k, def]) => {
        if (!_editParams[pluginName].hasOwnProperty(k)) {
            _editParams[pluginName][k] = def.default ?? '';
        }
    });

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
    const plugin    = _allPlugins.find(p => p.name === _paramsPlugin);
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
        return `
        <div class="bg-white/5 border border-white/10 rounded-lg px-3 py-2">
            <div class="flex items-center gap-1 mb-1">
                <span class="font-mono text-sm text-primary font-semibold">${escHtml(k)}</span>${typeHint}
            </div>
            ${desc}
            <input type="${def.type === 'int' ? 'number' : 'text'}"
                value="${escHtml(String(val))}"
                class="w-full mt-1.5 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white text-sm
                    focus:outline-none focus:border-primary/50"
                onchange="updateParamValue('${escHtml(k)}', this.value)">
        </div>`;
    }).join('');
}

function updateParamValue(key, value) {
    if (!_editParams[_paramsPlugin]) _editParams[_paramsPlugin] = {};
    _editParams[_paramsPlugin][key] = value;
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
