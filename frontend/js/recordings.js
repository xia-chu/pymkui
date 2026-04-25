/**
 * 录像管理页面逻辑
 * 依赖：api.js（apiGet/apiPost）
 */

let _recSelectedStream = null;   // { vhost, app, stream }
let _recAllStreams      = [];
let _recCurrentList    = [];     // 当前页录像数组
let _recSelectedDate   = '';     // 当前选中日期 YYYY-MM-DD

// ── 页面入口 ──────────────────────────────────────────────────────────
async function loadRecordingsPage() {
    // 默认选今天
    const today = new Date().toISOString().slice(0, 10);
    if (!_recSelectedDate) {
        _recSelectedDate = today;
        _fillDayTimeRange(today);
        _updateRecDateBtn(today);
    }
    await loadRecStreamList();
}

function _fillDayTimeRange(date) {
    const startEl = document.getElementById('recStartTime');
    const endEl   = document.getElementById('recEndTime');
    if (startEl) startEl.value = '00:00:00';
    if (endEl)   endEl.value   = '23:59:59';
}

function clearRecTimeRange() {
    const startEl = document.getElementById('recStartTime');
    const endEl   = document.getElementById('recEndTime');
    if (startEl) startEl.value = '';
    if (endEl)   endEl.value   = '';
    loadRecordingList();
}

// ── 左侧流列表 ────────────────────────────────────────────────────────
async function loadRecStreamList() {
    try {
        const res = await apiGet('/index/pyapi/recordings/streams');
        _recAllStreams = (res.code === 0 ? res.data : []) || [];
        renderRecStreamList(_recAllStreams);
    } catch (e) {
        console.error('loadRecStreamList:', e);
    }
}

function renderRecStreamList(list) {
    const ul = document.getElementById('recStreamList');
    if (!list.length) {
        ul.innerHTML = '<li class="text-white/30 text-xs text-center py-4">暂无录像记录</li>';
        return;
    }
    ul.innerHTML = list.map(s => {
        const isActive = _recSelectedStream &&
            _recSelectedStream.vhost  === s.vhost &&
            _recSelectedStream.app    === s.app   &&
            _recSelectedStream.stream === s.stream;
        const fullLabel = `${s.app}/${s.stream}`;
        return `<li class="group relative">
            <button onclick="selectRecStream('${escRec(s.vhost)}','${escRec(s.app)}','${escRec(s.stream)}')"
                title="${escHtmlRec(fullLabel)}\n${escHtmlRec(s.vhost)}"
                class="w-full text-left px-3 py-2 pr-8 rounded-lg text-sm transition
                    ${isActive ? 'bg-primary text-white font-semibold' : 'text-white/70 hover:bg-white/10'}">
                <div class="font-mono break-all leading-snug">${escHtmlRec(s.app)}/<wbr><span class="${isActive ? 'text-white' : 'text-primary/90'}">${escHtmlRec(s.stream)}</span></div>
                <div class="text-[10px] text-white/30 break-all leading-tight mt-0.5">${escHtmlRec(s.vhost)}</div>
            </button>
            <button onclick="deleteStreamAllRecordings('${escRec(s.vhost)}','${escRec(s.app)}','${escRec(s.stream)}')"
                title="删除该流全部录像"
                class="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-red-400/70 hover:text-red-400 p-1 rounded">
                <i class="fa fa-trash text-xs"></i>
            </button>
        </li>`;
    }).join('');
}

function filterRecStreamList() {
    const qv = (document.getElementById('recSearchVhost')?.value  || '').toLowerCase().trim();
    const qa = (document.getElementById('recSearchApp')?.value    || '').toLowerCase().trim();
    const qs = (document.getElementById('recSearchStream')?.value || '').toLowerCase().trim();
    renderRecStreamList(
        _recAllStreams.filter(s =>
            (!qv || s.vhost.toLowerCase().includes(qv)) &&
            (!qa || s.app.toLowerCase().includes(qa))   &&
            (!qs || s.stream.toLowerCase().includes(qs))
        )
    );
}

function selectRecStream(vhost, app, stream) {
    _recSelectedStream = { vhost, app, stream };
    filterRecStreamList();   // 保留搜索词，刷新高亮
    loadRecordingList();
}

// ── 从外部跳转到录像管理并定位到指定流 ──────────────────────────────
function navigateToRecordings(vhost, app, stream) {
    // 关闭流信息弹窗（如果存在）
    document.querySelectorAll('[data-modal="streams"]').forEach(m => m.remove());

    // 跳转到录像管理页
    if (typeof addTab === 'function') {
        addTab('recordings', '录像管理', 'fa-film');
    }

    // 等页面加载完后设置筛选条件
    const _apply = () => {
        // 设置搜索框
        const vh = document.getElementById('recSearchVhost');
        const ap = document.getElementById('recSearchApp');
        const st = document.getElementById('recSearchStream');
        if (!vh || !ap || !st) {
            setTimeout(_apply, 100);
            return;
        }
        if (vh) vh.value = vhost || '';
        if (ap) ap.value = app   || '';
        if (st) st.value = stream || '';

        // 设置今天日期
        const today = new Date().toISOString().slice(0, 10);
        _recSelectedDate = today;
        _updateRecDateBtn(today);
        _fillDayTimeRange(today);

        // 过滤流列表并选中该流
        filterRecStreamList();
        // 稍等流列表加载完毕再选中
        const _pick = () => {
            const found = _recAllStreams.find(
                s => s.vhost === vhost && s.app === app && s.stream === stream
            );
            if (found) {
                selectRecStream(vhost, app, stream);
            } else if (_recAllStreams.length === 0) {
                setTimeout(_pick, 150);
            }
        };
        _pick();
    };
    setTimeout(_apply, 200);
}

// ── 录像列表 ──────────────────────────────────────────────────────────
async function loadRecordingList() {
    if (!_recSelectedStream) return;
    const { vhost, app, stream } = _recSelectedStream;
    const date     = _recSelectedDate || '';
    const startVal = document.getElementById('recStartTime')?.value || '';
    const endVal   = document.getElementById('recEndTime')?.value   || '';
    // time 类型只有 HH:MM:SS，需要拼上日期才能转时间戳；无日期则取今天
    const baseDate = date || new Date().toISOString().slice(0, 10);
    const startTs  = startVal ? Math.floor(new Date(`${baseDate}T${startVal}`).getTime() / 1000) : 0;
    const endTs    = endVal   ? Math.floor(new Date(`${baseDate}T${endVal}`).getTime()   / 1000) : 0;

    try {
        // ① 时间轴：只按日期查全天，不受起止时间影响
        const timelineParams = new URLSearchParams({ vhost, app, stream, limit: 500 });
        if (date) timelineParams.set('date', date);
        const tlRes = await apiGet('/index/pyapi/recordings?' + timelineParams.toString());
        const allDayList = (tlRes.code === 0 ? tlRes.data : []) || [];
        renderTimeline(allDayList, date);

        // ② 文件列表：在全天数据基础上叠加起止时间过滤（前端直接过滤，避免多一次请求）
        _recCurrentList = (startTs || endTs)
            ? allDayList.filter(r => {
                const ts = r.start_time || 0;
                if (startTs && ts < startTs) return false;
                if (endTs   && ts > endTs)   return false;
                return true;
              })
            : allDayList;

        renderRecTable(_recCurrentList);
        document.getElementById('recStatText').textContent =
            `共 ${_recCurrentList.length} 条`;
    } catch (e) {
        console.error('loadRecordingList:', e);
    }
}

function renderRecTable(list) {
    const tbody = document.getElementById('recTableBody');
    if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-white/30 py-10">暂无录像</td></tr>';
        return;
    }
    tbody.innerHTML = list.map(r => {
        const dt = r.start_time
            ? new Date(r.start_time * 1000).toLocaleString('zh-CN', { hour12: false })
            : r.created_at || '';
        const duration = r.time_len ? fmtDuration(r.time_len) : '-';
        const size = r.file_size ? fmtSize(r.file_size) : '-';
        return `<tr class="border-b border-white/5 hover:bg-white/5 transition">
            <td class="py-2.5 px-4 font-mono text-sm text-white/80 truncate max-w-[200px]" title="${escHtmlRec(r.file_path || '')}">${escHtmlRec(r.file_name || r.url || '')}</td>
            <td class="py-2.5 px-4 text-sm text-white/60">${escHtmlRec(dt)}</td>
            <td class="py-2.5 px-4 text-sm text-white/60">${duration}</td>
            <td class="py-2.5 px-4 text-sm text-white/60">${size}</td>
            <td class="py-2.5 px-4">
                <button onclick="playRecording(${r.id})"
                    class="text-primary/80 hover:text-primary text-xs transition mr-3" title="播放">
                    <i class="fa fa-play mr-1"></i>播放
                </button>
                <a href="/index/pyapi/recordings/file?id=${r.id}&disposition=attachment"
                    download="${escHtmlRec(r.file_name || 'recording.mp4')}"
                    class="text-green-400/70 hover:text-green-400 text-xs transition mr-3" title="下载">
                    <i class="fa fa-download mr-1"></i>下载
                </a>
                <button onclick="deleteRecording(${r.id})"
                    class="text-red-400/70 hover:text-red-400 text-xs transition" title="删除记录">
                    <i class="fa fa-trash mr-1"></i>删除
                </button>
            </td>
        </tr>`;
    }).join('');
}

// ── 时间轴渲染 ────────────────────────────────────────────────────────
function renderTimeline(list, date) {
    const track   = document.getElementById('timelineTrack');
    const tipEl   = document.getElementById('timelineTip');
    const dateEl  = document.getElementById('timelineDate');
    track.innerHTML = '';

    dateEl.textContent = date || '全部日期';

    if (!list.length) return;

    // 确定基准日期的 00:00:00 时间戳（秒）
    let baseTs;
    if (date) {
        baseTs = Math.floor(new Date(date + 'T00:00:00').getTime() / 1000);
    } else {
        // 无日期筛选：取最早录像当天 00:00:00
        const earliest = Math.min(...list.map(r => r.start_time || 0).filter(Boolean));
        const d = new Date(earliest * 1000);
        d.setHours(0, 0, 0, 0);
        baseTs = Math.floor(d.getTime() / 1000);
    }
    const DAY_SEC = 86400;

    list.forEach(r => {
        if (!r.start_time) return;
        const startOff = r.start_time - baseTs;
        const dur      = Math.max(r.time_len || 0, 1);
        const left     = Math.max(0, startOff / DAY_SEC) * 100;
        const width    = Math.min(dur / DAY_SEC * 100, 100 - left);
        if (left >= 100) return;

        const bar = document.createElement('div');
        bar.className = 'absolute top-1 bottom-4 rounded-sm bg-primary/70 hover:bg-primary cursor-pointer transition-colors';
        bar.style.left  = left + '%';
        bar.style.width = Math.max(width, 0.3) + '%';
        bar.title = r.file_name || '';

        // 鼠标悬停 Tooltip
        bar.addEventListener('mousemove', ev => {
            const rect = track.getBoundingClientRect();
            tipEl.classList.remove('hidden');
            tipEl.style.left = Math.min(ev.clientX - rect.left, rect.width - 160) + 'px';
            const dt = new Date(r.start_time * 1000).toLocaleTimeString('zh-CN', { hour12: false });
            tipEl.textContent = `${dt}  ${fmtDuration(r.time_len || 0)}  ${fmtSize(r.file_size || 0)}`;
        });
        bar.addEventListener('mouseleave', () => tipEl.classList.add('hidden'));

        // 点击高亮对应表格行
        bar.addEventListener('click', () => {
            scrollToRecordRow(r.id);
        });

        track.appendChild(bar);
    });

    // ── 拖拽框选时间段 ────────────────────────────────────────────────
    _initTimelineDrag(track, baseTs, tipEl);
}

// 拖拽框选：长按 200ms 后进入框选模式，松开后更新起止时间并重新查询
function _initTimelineDrag(track, baseTs, tipEl) {
    const DAY_SEC = 86400;
    let dragState = null;   // { startX, selEl }
    let holdTimer = null;

    // 选区元素
    let selEl = track.querySelector('.rec-sel-box');
    if (!selEl) {
        selEl = document.createElement('div');
        selEl.className = 'rec-sel-box absolute top-0 bottom-4 bg-yellow-400/30 border border-yellow-400/70 pointer-events-none hidden rounded';
        track.appendChild(selEl);
    }

    // 清除旧的监听（通过替换节点）
    const newTrack = track.cloneNode(true);
    track.parentNode.replaceChild(newTrack, track);
    // 重新拿新节点
    const t = newTrack;
    const s = t.querySelector('.rec-sel-box');

    const pct2ts = pct => baseTs + Math.round(pct / 100 * DAY_SEC);
    const ts2Str = ts => {
        const d = new Date(ts * 1000);
        const pad = n => String(n).padStart(2, '0');
        return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };

    t.addEventListener('mousedown', ev => {
        if (ev.button !== 0) return;
        const rect = t.getBoundingClientRect();
        const x0 = ev.clientX - rect.left;
        holdTimer = setTimeout(() => {
            dragState = { startX: x0, rect };
            s.style.left  = (x0 / rect.width * 100) + '%';
            s.style.width = '0%';
            s.classList.remove('hidden');
            t.style.cursor = 'crosshair';        }, 200);
    });

    document.addEventListener('mousemove', ev => {
        if (!dragState) return;
        tipEl.classList.add('hidden');
        const rect = dragState.rect;
        const x  = Math.max(0, Math.min(ev.clientX - rect.left, rect.width));
        const x0 = dragState.startX;
        const w  = rect.width;
        const left  = Math.min(x0, x);
        const right = Math.max(x0, x);
        s.style.left  = (left  / w * 100) + '%';
        s.style.width = ((right - left) / w * 100) + '%';

        // 实时显示时间提示
        const tsL = pct2ts(left  / w * 100);
        const tsR = pct2ts(right / w * 100);
        const fmt = ts => new Date(ts * 1000).toLocaleTimeString('zh-CN', { hour12: false });
        const tipX = Math.min(right + 4, w - 100);
        tipEl.style.left = tipX + 'px';
        tipEl.textContent = `${fmt(tsL)} ~ ${fmt(tsR)}`;
        tipEl.classList.remove('hidden');
    });

    document.addEventListener('mouseup', ev => {
        clearTimeout(holdTimer);
        holdTimer = null;
        if (!dragState) return;
        tipEl.classList.add('hidden');
        t.style.cursor = 'pointer';

        const rect = dragState.rect;
        const x0   = dragState.startX;
        const x1   = Math.max(0, Math.min(ev.clientX - rect.left, rect.width));
        dragState = null;
        s.classList.add('hidden');

        const pL = Math.min(x0, x1) / rect.width * 100;
        const pR = Math.max(x0, x1) / rect.width * 100;
        if (pR - pL < 0.5) return;  // 选区太小忽略

        const tsStart = pct2ts(pL);
        const tsEnd   = pct2ts(pR);

        const startEl = document.getElementById('recStartTime');
        const endEl   = document.getElementById('recEndTime');
        if (startEl) startEl.value = ts2Str(tsStart);
        if (endEl)   endEl.value   = ts2Str(tsEnd);

        loadRecordingList();
    });

    t.addEventListener('mouseleave', () => {
        // 鼠标离开轨道时只取消长按计时，拖拽中不中断（由 document mouseup 处理）
        clearTimeout(holdTimer);
        holdTimer = null;
        if (!dragState) tipEl.classList.add('hidden');
    });
}

function scrollToRecordRow(id) {
    const tbody = document.getElementById('recTableBody');
    const rows  = tbody.querySelectorAll('tr');
    const idx   = _recCurrentList.findIndex(r => r.id === id);
    if (idx >= 0 && rows[idx]) {
        rows[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
        rows[idx].classList.add('bg-primary/20');
        setTimeout(() => rows[idx].classList.remove('bg-primary/20'), 1500);
    }
}

// ── 删除录像记录 ──────────────────────────────────────────────────────
async function deleteRecording(id) {
    if (!confirm('确定删除此录像记录？（仅删数据库记录，不删文件）')) return;
    try {
        const res = await apiPost('/index/pyapi/recordings/delete', { id });
        if (res.code === 0) {
            showToast('已删除', 'success');
            await loadRecordingList();
            await loadRecStreamList();
        } else {
            showToast(res.msg || '删除失败', 'error');
        }
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function deleteStreamAllRecordings(vhost, app, stream) {
    if (!confirm(`确定删除流 ${app}/${stream} 的全部录像记录及文件？此操作不可恢复！`)) return;
    try {
        const res = await apiPost('/index/pyapi/recordings/delete_stream', { vhost, app, stream });
        if (res.code === 0) {
            showToast(res.msg || '删除成功', 'success');
            // 若当前选中的就是该流，清空选中状态
            if (_recSelectedStream &&
                _recSelectedStream.vhost === vhost &&
                _recSelectedStream.app === app &&
                _recSelectedStream.stream === stream) {
                _recSelectedStream = null;
                document.getElementById('recTableBody').innerHTML =
                    '<tr><td colspan="5" class="text-center text-white/30 py-10">← 请先选择左侧流</td></tr>';
                document.getElementById('timelineTrack').innerHTML = '';
                document.getElementById('timelineDate').textContent = '';
            }
            await loadRecStreamList();
        } else {
            showToast(res.msg || '删除失败', 'error');
        }
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function deleteDayRecordings() {
    if (!_recSelectedStream) { showToast('请先选择左侧流', 'warning'); return; }
    const date = _recSelectedDate;
    if (!date) { showToast('请先选择日期', 'warning'); return; }
    const { vhost, app, stream } = _recSelectedStream;
    if (!confirm(`确定删除 ${app}/${stream} 在 ${date} 的全部录像记录及文件？此操作不可恢复！`)) return;
    try {
        const res = await apiPost('/index/pyapi/recordings/delete_day', { vhost, app, stream, date });
        if (res.code === 0) {
            showToast(res.msg || '删除成功', 'success');
            await loadRecordingList();
            await loadRecStreamList();
        } else {
            showToast(res.msg || '删除失败', 'error');
        }
    } catch (e) {
        showToast(e.message, 'error');
    }
}

// ── 工具函数 ──────────────────────────────────────────────────────────
function fmtDuration(sec) {
    sec = Math.round(sec);
    if (sec < 60)  return sec + ' 秒';
    if (sec < 3600) return Math.floor(sec / 60) + ' 分 ' + (sec % 60) + ' 秒';
    return Math.floor(sec / 3600) + ' 时 ' + Math.floor((sec % 3600) / 60) + ' 分';
}
function fmtSize(bytes) {
    if (bytes < 1024)       return bytes + ' B';
    if (bytes < 1048576)    return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
}
function escHtmlRec(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escRec(s) {
    return String(s).replace(/'/g, "\\'");
}

// ══════════════════════════════════════════════════════════════════════
// 自定义日历组件
// ══════════════════════════════════════════════════════════════════════
let _calYear  = 0;
let _calMonth = 0;   // 1-12
let _calDates = new Set();   // 当月有录像的日期 Set<'YYYY-MM-DD'>

function _updateRecDateBtn(date) {
    const btn = document.getElementById('recDateBtnText');
    if (btn) btn.textContent = date || '选择日期';
}

function toggleRecCalendar() {
    const pop = document.getElementById('recCalendarPop');
    if (!pop) return;
    const isHidden = pop.classList.contains('hidden');
    if (isHidden) {
        // 打开：以当前选中日期或今天为基准
        const base = _recSelectedDate || new Date().toISOString().slice(0, 10);
        const [y, m] = base.split('-').map(Number);
        _calYear  = y;
        _calMonth = m;
        _renderCalendar();
        pop.classList.remove('hidden');
        // 点击外部关闭
        setTimeout(() => {
            document.addEventListener('click', _closeCalOutside, { once: true });
        }, 0);
    } else {
        pop.classList.add('hidden');
    }
}

function _closeCalOutside(ev) {
    const pop = document.getElementById('recCalendarPop');
    const btn = document.getElementById('recDateBtn');
    if (pop && !pop.contains(ev.target) && btn && !btn.contains(ev.target)) {
        pop.classList.add('hidden');
    } else {
        // 点在内部，继续监听
        document.addEventListener('click', _closeCalOutside, { once: true });
    }
}

function recCalNav(delta) {
    _calMonth += delta;
    if (_calMonth > 12) { _calMonth = 1;  _calYear++; }
    if (_calMonth < 1)  { _calMonth = 12; _calYear--; }
    _renderCalendar();
}

async function _renderCalendar() {
    const label = document.getElementById('recCalMonthLabel');
    const grid  = document.getElementById('recCalGrid');
    if (!label || !grid) return;

    label.textContent = `${_calYear} 年 ${_calMonth} 月`;
    grid.innerHTML = '<div class="col-span-7 text-center text-white/30 text-xs py-2">加载中…</div>';

    // 查询当月有录像的日期（带当前选中的流过滤）
    try {
        const params = new URLSearchParams({ year: _calYear, month: _calMonth });
        if (_recSelectedStream) {
            params.set('vhost',  _recSelectedStream.vhost);
            params.set('app',    _recSelectedStream.app);
            params.set('stream', _recSelectedStream.stream);
        }
        const res = await apiGet('/index/pyapi/recordings/dates?' + params.toString());
        _calDates = new Set(res.code === 0 ? res.data : []);
    } catch (e) {
        _calDates = new Set();
    }

    _buildCalGrid();
}

function _buildCalGrid() {
    const grid = document.getElementById('recCalGrid');
    if (!grid) return;

    const firstDay = new Date(_calYear, _calMonth - 1, 1).getDay(); // 0=日
    const daysInMonth = new Date(_calYear, _calMonth, 0).getDate();
    const today = new Date().toISOString().slice(0, 10);

    let html = '';
    // 空格补齐
    for (let i = 0; i < firstDay; i++) {
        html += '<div></div>';
    }
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${_calYear}-${String(_calMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const isSelected = dateStr === _recSelectedDate;
        const isToday    = dateStr === today;
        const hasRec     = _calDates.has(dateStr);

        const base = 'relative flex flex-col items-center justify-center rounded-lg py-1 cursor-pointer transition ';
        let cls = base;
        if (isSelected) {
            cls += 'bg-primary text-white font-bold';
        } else if (isToday) {
            cls += 'border border-primary/60 text-white hover:bg-white/10';
        } else {
            cls += 'text-white/70 hover:bg-white/10';
        }

        html += `<div class="${cls}" onclick="selectRecDate('${dateStr}')">
            <span>${d}</span>
            ${hasRec ? `<span class="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-red-400'}"></span>` : ''}
        </div>`;
    }
    grid.innerHTML = html;
}

function selectRecDate(dateStr) {
    _recSelectedDate = dateStr;
    _updateRecDateBtn(dateStr);
    _fillDayTimeRange(dateStr);
    // 刷新日历格子高亮
    _buildCalGrid();
    // 关闭弹窗
    document.getElementById('recCalendarPop')?.classList.add('hidden');
    loadRecordingList();
}

function clearRecDate() {
    _recSelectedDate = '';
    _updateRecDateBtn('');
    document.getElementById('recCalendarPop')?.classList.add('hidden');
    loadRecordingList();
}

// ── 全天播放状态 ──────────────────────────────────────────────────────
const _dp = {
    list: [],       // 录像列表
    offsets: [],    // 各段累积起始秒 [0, dur0, dur0+dur1, ...]
    total: 0,       // 总时长（秒）
    idx: 0,         // 当前段
    label: '',      // 标题标识
    raf: null,      // requestAnimationFrame id
    seekingTo: null,// 拖拽/seek 中的目标全局秒（用于 tick 显示正确位置）
    speed: 1,       // 播放倍速
};

function _dpUrl(id) { return `/index/pyapi/recordings/file?id=${id}&disposition=inline`; }

function _dpFmtTime(s) {
    s = Math.floor(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h > 0
        ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
        : `${m}:${String(sec).padStart(2,'0')}`;
}

// 根据全局秒数找到对应段 idx 和段内偏移
function _dpSegAt(globalSec) {
    const offsets = _dp.offsets;
    let idx = 0;
    for (let i = offsets.length - 1; i >= 0; i--) {
        if (globalSec >= offsets[i]) { idx = i; break; }
    }
    const offset = globalSec - offsets[idx];
    return { idx, offset };
}

// 更新自定义进度条
function _dpTick() {
    const videoA = document.getElementById('_dpVideoA');
    if (!videoA) return;
    // seeking 中用手动记录的值，不读 currentTime（load 中 currentTime 可能是旧值）
    const globalSec = _dp.seekingTo != null
        ? _dp.seekingTo
        : _dp.offsets[_dp.idx] + (isNaN(videoA.currentTime) ? 0 : videoA.currentTime);
    const pct = _dp.total > 0 ? Math.min(globalSec / _dp.total, 1) : 0;

    const bar = document.getElementById('_dpBar');
    const timeCur = document.getElementById('_dpTimeCur');
    const timeTotal = document.getElementById('_dpTimeTotal');
    if (bar) bar.style.width = (pct * 100).toFixed(2) + '%';
    if (timeCur) timeCur.textContent = _dpFmtTime(globalSec);
    if (timeTotal) timeTotal.textContent = _dpFmtTime(_dp.total);

    _dp.raf = requestAnimationFrame(_dpTick);
}

// 切换到指定段，从 offsetSec 开始播放
function _dpGoTo(idx, offsetSec) {
    if (idx >= _dp.list.length) {
        const titleEl = document.getElementById('_dpTitle');
        if (titleEl) titleEl.textContent = _dp.label + ' · 播放完毕';
        _dp.seekingTo = null;
        return;
    }
    _dp.idx = idx;
    const rec = _dp.list[idx];
    const url = _dpUrl(rec.id);

    const titleEl = document.getElementById('_dpTitle');
    if (titleEl) titleEl.textContent = `${_dp.label} (${idx + 1}/${_dp.list.length})`;

    const videoA = document.getElementById('_dpVideoA');
    const videoB = document.getElementById('_dpVideoB');

    videoA.onended = null; // 先解绑，防止 load 触发旧 ended 回调

    // 记录目标全局时间（用于 tick 显示正确位置）
    _dp.seekingTo = _dp.offsets[idx] + offsetSec;

    videoA.src = url;
    videoA.load();

    videoA.addEventListener('loadedmetadata', function onMeta() {
        videoA.removeEventListener('loadedmetadata', onMeta);
        if (offsetSec > 0) videoA.currentTime = offsetSec;
        if (_dp.speed && _dp.speed !== 1) videoA.playbackRate = _dp.speed;
        _dp.seekingTo = null; // 可以开始正常 tick 了
        videoA.play().catch(() => {});
    }, { once: true });

    // 预加载下一段
    if (videoB && idx + 1 < _dp.list.length) {
        videoB.src = _dpUrl(_dp.list[idx + 1].id);
        videoB.preload = 'auto';
        videoB.load();
    } else if (videoB) {
        videoB.src = '';
    }

    // 播完自动切下一段
    videoA.onended = () => {
        if (_dp.idx !== idx) return;
        _dpGoTo(idx + 1, 0);
    };
}

// 根据鼠标位置计算全局秒数
function _dpPctToSec(e) {
    const track = document.getElementById('_dpTrack');
    if (!track || _dp.total === 0) return null;
    const rect = track.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return pct * _dp.total;
}

// 只更新进度条视觉（拖拽中预览用，不触发 load）
function _dpPreviewBar(globalSec) {
    const pct = _dp.total > 0 ? Math.min(globalSec / _dp.total, 1) : 0;
    const bar = document.getElementById('_dpBar');
    const timeCur = document.getElementById('_dpTimeCur');
    if (bar) bar.style.width = (pct * 100).toFixed(2) + '%';
    if (timeCur) timeCur.textContent = _dpFmtTime(globalSec);
}

// 进度条点击 seek（非拖拽）
function _dpSeek(e) {
    // 如果是拖拽结束触发的 click 事件，忽略（mouseup 已处理）
    if (window._dpJustDragged) { window._dpJustDragged = false; return; }
    const sec = _dpPctToSec(e);
    if (sec == null) return;
    const { idx, offset } = _dpSegAt(sec);
    _dpGoTo(idx, offset);
}

// ── 播放全天录像 ──────────────────────────────────────────────────────
function playDayRecordings() {
    if (!_recSelectedStream) { showToast('请先选择左侧流', 'error'); return; }
    const date = _recSelectedDate;
    if (!date) { showToast('请先选择日期', 'error'); return; }
    const { vhost, app, stream } = _recSelectedStream;
    const params = new URLSearchParams({ vhost, app, stream, date });

    fetch(`/index/pyapi/recordings/day?${params.toString()}`)
        .then(r => r.json())
        .then(res => {
            if (res.code !== 0 || !res.data || res.data.length === 0) {
                showToast(res.msg || '该流当天暂无录像', 'error'); return;
            }
            _startDayPlayer(res.data, `全天 · ${app}/${stream} · ${date}`);
        })
        .catch(() => showToast('获取全天录像列表失败', 'error'));
}

function _startDayPlayer(list, label) {
    // 计算累积偏移
    const offsets = [0];
    for (let i = 0; i < list.length - 1; i++) {
        offsets.push(offsets[i] + (list[i].time_len || 0));
    }
    const total = offsets[offsets.length - 1] + (list[list.length - 1].time_len || 0);

    _dp.list = list; _dp.offsets = offsets; _dp.total = total; _dp.idx = 0; _dp.label = label; _dp.seekingTo = null; _dp.speed = 1;

    // 构建/复用弹窗
    let modal = document.getElementById('recPlayerModal');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'recPlayerModal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm';
    modal.innerHTML = `
        <div class="relative bg-gray-900 rounded-2xl shadow-2xl overflow-hidden w-full max-w-3xl mx-4" id="_dpPanel" onclick="event.stopPropagation()">
            <div class="flex items-center justify-between px-5 py-3 border-b border-white/10">
                <span class="text-white font-semibold text-sm" id="_dpTitle">${label}</span>
                <div class="flex items-center gap-2">
                    <!-- 倍速选择 -->
                    <select id="_dpSpeed" onchange="_dpSetSpeed(this.value)"
                        class="bg-gray-800 text-white/80 text-xs rounded px-2 py-1 border border-white/10 outline-none cursor-pointer">
                        <option value="0.5">0.5×</option>
                        <option value="1" selected>1×</option>
                        <option value="1.5">1.5×</option>
                        <option value="2">2×</option>
                        <option value="4">4×</option>
                    </select>
                    <!-- 全屏 -->
                    <button onclick="_dpToggleFullscreen()" title="全屏"
                        class="text-white/60 hover:text-white transition px-1 text-base leading-none">⛶</button>
                    <button onclick="closeRecPlayer()" class="text-white/50 hover:text-white transition text-lg leading-none">&times;</button>
                </div>
            </div>
            <div class="bg-black relative" id="_dpVideoWrap">
                <video id="_dpVideoA" autoplay
                    class="w-full max-h-[65vh] bg-black outline-none block"
                    style="min-height:200px;"></video>
                <video id="_dpVideoB" preload="auto" style="display:none"></video>
            </div>
            <!-- 自定义进度条 -->
            <div class="px-4 pt-2 pb-3 bg-gray-900 select-none" id="_dpControlBar">
                <div id="_dpTrack" class="relative h-2 bg-white/20 rounded-full cursor-pointer"
                    style="user-select:none"
                    onmousedown="_dpSeekStart(event)"
                    onclick="_dpSeek(event)">
                    <div id="_dpBar" class="absolute left-0 top-0 h-2 bg-blue-500 rounded-full transition-none" style="width:0%"></div>
                </div>
                <div class="flex justify-between text-xs text-white/50 mt-1">
                    <span id="_dpTimeCur">0:00</span>
                    <span id="_dpTimeTotal">${_dpFmtTime(total)}</span>
                </div>
            </div>
        </div>`;
    modal.addEventListener('click', e => { if (e.target === modal) closeRecPlayer(); });
    document.body.appendChild(modal);

    // 拖拽 seek 支持：拖拽中只预览，mouseup 才真正跳转
    window._dpDragging = false;
    window._dpJustDragged = false;
    window._dpSeekStart = function(e) {
        window._dpDragging = true;
        // 拖拽期间暂停 tick（进度条由拖拽预览接管）
        if (_dp.raf) { cancelAnimationFrame(_dp.raf); _dp.raf = null; }
        _dpPreviewBar(_dpPctToSec(e) || 0);

        const onMove = ev => {
            if (!window._dpDragging) return;
            const sec = _dpPctToSec(ev);
            if (sec != null) _dpPreviewBar(sec);
        };
        const onUp = ev => {
            window._dpDragging = false;
            window._dpJustDragged = true;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            const sec = _dpPctToSec(ev);
            if (sec != null) {
                const { idx, offset } = _dpSegAt(sec);
                _dpGoTo(idx, offset);
            }
            // 恢复 tick
            if (!_dp.raf) _dp.raf = requestAnimationFrame(_dpTick);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    };

    if (_dp.raf) cancelAnimationFrame(_dp.raf);
    _dp.raf = requestAnimationFrame(_dpTick);

    // 全屏变化时，同步倍速并让控制栏覆盖在全屏视频上
    document.addEventListener('fullscreenchange', _dpOnFullscreenChange);

    _dpGoTo(0, 0);
}

// 设置倍速（切换 src 后也需重设，在 loadedmetadata 中处理）
function _dpSetSpeed(val) {
    _dp.speed = parseFloat(val) || 1;
    const v = document.getElementById('_dpVideoA');
    if (v) v.playbackRate = _dp.speed;
}

// 全屏切换
function _dpToggleFullscreen() {
    const panel = document.getElementById('_dpPanel');
    if (!panel) return;
    if (!document.fullscreenElement) {
        panel.requestFullscreen().catch(() => {});
    } else {
        document.exitFullscreen().catch(() => {});
    }
}

// 全屏变化回调：全屏时让控制栏固定在底部
function _dpOnFullscreenChange() {
    const panel = document.getElementById('_dpPanel');
    const videoWrap = document.getElementById('_dpVideoWrap');
    const ctrl = document.getElementById('_dpControlBar');
    if (!panel) return;
    if (document.fullscreenElement === panel) {
        // 进入全屏：视频撑满，控制栏绝对定位在底部
        panel.style.cssText = 'position:relative;width:100%;height:100%;max-width:none;border-radius:0;display:flex;flex-direction:column;';
        if (videoWrap) videoWrap.style.cssText = 'flex:1;overflow:hidden;';
        const v = document.getElementById('_dpVideoA');
        if (v) v.style.cssText = 'width:100%;height:100%;max-height:none;object-fit:contain;';
        if (ctrl) ctrl.style.cssText = 'flex-shrink:0;';
    } else {
        // 退出全屏：恢复样式
        panel.style.cssText = '';
        if (videoWrap) videoWrap.style.cssText = '';
        const v = document.getElementById('_dpVideoA');
        if (v) v.style.cssText = 'min-height:200px;';
        if (ctrl) ctrl.style.cssText = '';
    }
}

// ── 播放单条录像 ──────────────────────────────────────────────────────
function playRecording(id) {
    closeRecPlayer(); // 先关闭旧弹窗
    const url = `/index/pyapi/recordings/file?id=${id}&disposition=inline`;
    const modal = document.createElement('div');
    modal.id = 'recPlayerModal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm';
    modal.innerHTML = `
        <div class="relative bg-gray-900 rounded-2xl shadow-2xl overflow-hidden w-full max-w-3xl mx-4" onclick="event.stopPropagation()">
            <div class="flex items-center justify-between px-5 py-3 border-b border-white/10">
                <span class="text-white font-semibold text-sm">录像播放</span>
                <button onclick="closeRecPlayer()" class="text-white/50 hover:text-white transition text-lg leading-none">&times;</button>
            </div>
            <div class="p-4 bg-black">
                <video id="recPlayerVideo" controls autoplay
                    class="w-full rounded-lg max-h-[70vh] bg-black outline-none"
                    style="min-height:200px;"></video>
            </div>
        </div>`;
    modal.addEventListener('click', e => { if (e.target === modal) closeRecPlayer(); });
    document.body.appendChild(modal);
    const video = document.getElementById('recPlayerVideo');
    video.src = url;
    video.load();
    video.play().catch(() => {});
}

function closeRecPlayer() {
    if (_dp.raf) { cancelAnimationFrame(_dp.raf); _dp.raf = null; }
    document.removeEventListener('fullscreenchange', _dpOnFullscreenChange);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    const modal = document.getElementById('recPlayerModal');
    if (modal) {
        ['_dpVideoA', '_dpVideoB', 'recPlayerVideo'].forEach(id => {
            const v = document.getElementById(id);
            if (v) { v.pause(); v.onended = null; v.src = ''; }
        });
        if (window._recHls) { window._recHls.destroy(); window._recHls = null; }
        modal.remove();
    }
}
