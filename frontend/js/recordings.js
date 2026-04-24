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
        return `<li>
            <button onclick="selectRecStream('${escRec(s.vhost)}','${escRec(s.app)}','${escRec(s.stream)}')"
                title="${escHtmlRec(fullLabel)}\n${escHtmlRec(s.vhost)}"
                class="w-full text-left px-3 py-2 rounded-lg text-sm transition
                    ${isActive ? 'bg-primary text-white font-semibold' : 'text-white/70 hover:bg-white/10'}">
                <div class="font-mono break-all leading-snug">${escHtmlRec(s.app)}/<wbr><span class="${isActive ? 'text-white' : 'text-primary/90'}">${escHtmlRec(s.stream)}</span></div>
                <div class="text-[10px] text-white/30 break-all leading-tight mt-0.5">${escHtmlRec(s.vhost)}</div>
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

// ── 播放录像 ──────────────────────────────────────────────────────────
function playRecording(id) {
    const url = `/index/pyapi/recordings/file?id=${id}&disposition=inline`;
    // 复用或新建模态框
    let modal = document.getElementById('recPlayerModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'recPlayerModal';
        modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm';
        modal.innerHTML = `
            <div class="relative bg-gray-900 rounded-2xl shadow-2xl overflow-hidden w-full max-w-3xl mx-4">
                <div class="flex items-center justify-between px-5 py-3 border-b border-white/10">
                    <span class="text-white font-semibold text-sm">录像播放</span>
                    <button onclick="closeRecPlayer()" class="text-white/50 hover:text-white transition text-lg leading-none">&times;</button>
                </div>
                <div class="p-4 bg-black">
                    <video id="recPlayerVideo" controls autoplay
                        class="w-full rounded-lg max-h-[70vh] bg-black outline-none"
                        style="min-height:200px;">
                        您的浏览器不支持 video 标签。
                    </video>
                </div>
            </div>`;
        modal.addEventListener('click', e => { if (e.target === modal) closeRecPlayer(); });
        document.body.appendChild(modal);
    }
    const video = document.getElementById('recPlayerVideo');
    video.src = url;
    video.load();
    video.play().catch(() => {});
    modal.classList.remove('hidden');
}

function closeRecPlayer() {
    const modal = document.getElementById('recPlayerModal');
    if (modal) {
        const video = document.getElementById('recPlayerVideo');
        if (video) { video.pause(); video.src = ''; }
        modal.classList.add('hidden');
    }
}
