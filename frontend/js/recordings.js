/**
 * 录像管理页面逻辑
 * 依赖：api.js（apiGet/apiPost）
 */

let _recSelectedStream = null;   // { vhost, app, stream }
let _recAllStreams      = [];
let _recCurrentList    = [];     // 当前页录像数组

// ── 页面入口 ──────────────────────────────────────────────────────────
async function loadRecordingsPage() {
    // 默认选今天
    const today = new Date().toISOString().slice(0, 10);
    const picker = document.getElementById('recDatePicker');
    if (picker && !picker.value) picker.value = today;

    await loadRecStreamList();
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

// ── 录像列表 ──────────────────────────────────────────────────────────
async function loadRecordingList() {
    if (!_recSelectedStream) return;
    const { vhost, app, stream } = _recSelectedStream;
    const date = document.getElementById('recDatePicker').value || '';

    try {
        const params = new URLSearchParams({ vhost, app, stream, limit: 500 });
        if (date) params.set('date', date);
        const res = await apiGet('/index/pyapi/recordings?' + params.toString());
        _recCurrentList = (res.code === 0 ? res.data : []) || [];
        renderRecTable(_recCurrentList);
        renderTimeline(_recCurrentList, date);
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
