const jessibucaInstances = [];
const hlsInstances = [];

function cleanupStreamsPage() {
    console.log('清理视频管理页面资源，销毁所有播放器实例');
    
    // 销毁Jessibuca播放器实例
    jessibucaInstances.forEach(instance => {
        try {
            if (instance) {
                instance.destroy();
            }
        } catch (error) {
            console.error('销毁Jessibuca播放器实例失败:', error);
        }
    });
    jessibucaInstances.length = 0;
    
    // 销毁HLS播放器实例
    hlsInstances.forEach(instance => {
        try {
            if (instance) {
                instance.destroy();
            }
        } catch (error) {
            console.error('销毁HLS播放器实例失败:', error);
        }
    });
    hlsInstances.length = 0;
    
    // 清空模态框容器
    const streamsModalContainer = document.getElementById('streams-modal-container');
    if (streamsModalContainer) {
        streamsModalContainer.innerHTML = '';
    }
}

async function loadStreams() {
    const tbody = document.getElementById('streamsTableBody');
    const protocolFilter = document.getElementById('protocolFilter');
    const vhostFilter = document.getElementById('vhostFilter');
    const appFilter = document.getElementById('appFilter');
    const streamFilter = document.getElementById('streamFilter');
    
    const schema = protocolFilter ? protocolFilter.value : 'all';
    const vhost = vhostFilter ? vhostFilter.value.trim() : '';
    const app = appFilter ? appFilter.value.trim() : '';
    const stream = streamFilter ? streamFilter.value.trim() : '';
    
    tbody.innerHTML = `
        <tr>
            <td colspan="10" class="p-10 text-center">
                <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto mb-4"></div>
                <span class="text-white/60 font-semibold">加载中...</span>
            </td>
        </tr>
    `;
    
    try {
        const result = await Api.getMediaList(
            schema === 'all' ? undefined : schema,
            vhost || undefined,
            app || undefined,
            stream || undefined
        );
        
        console.log('getMediaList返回结果:', result);
        
        if (result.code === 0) {
            const data = result.data || [];
            
            console.log('流列表数据:', data);
            
            if (data.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="10" class="p-10 text-center text-white/60 font-semibold">
                            暂无媒体流
                        </td>
                    </tr>
                `;
                return;
            }
            
            let html = '';
            data.forEach(stream => {
                console.log('流数据:', stream);
                const vhost = stream.vhost || '__defaultVhost__';
                const readerCount = stream.readerCount || 0;
                const aliveSecond = stream.aliveSecond || 0;
                const bytesSpeed = stream.bytesSpeed || 0;
                
                const aliveTime = formatAliveTime(aliveSecond);
                const bitrate = formatBitrate(bytesSpeed);
                
                // 处理轨道信息
                let tracksInfo = '-';
                if (stream.tracks && stream.tracks.length > 0) {
                    const trackCodes = stream.tracks.map(track => {
                        const codec = track.codec_id_name || track.codec_name || '-';
                        return track.codec_type === 0 ? `视频: ${codec}` : `音频: ${codec}`;
                    });
                    tracksInfo = trackCodes.join('<br>');
                }
                
                html += `
                    <tr class="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td class="p-4 text-white/60 text-sm" title="${vhost}">${vhost}</td>
                        <td class="p-4 text-white">${stream.app || '-'}</td>
                        <td class="p-4 text-white">${stream.stream || '-'}</td>
                        <td class="p-4 text-white">${stream.schema || '-'}</td>
                        <td class="p-4 text-white">${stream.originTypeStr || '-'}</td>
                        <td class="p-4 text-white">${readerCount}</td>
                        <td class="p-4 text-white">${aliveTime}</td>
                        <td class="p-4 text-white">${bitrate}</td>
                        <td class="p-4 text-white" style="white-space: pre-line;">${tracksInfo}</td>
                        <td class="p-4">
                            <button class="bg-gradient-primary text-white px-3 py-1 rounded-lg text-sm font-semibold hover:shadow-neon transition-colors mr-2" onclick="playStream('${stream.app}', '${stream.stream}', '${stream.schema}')">播放</button>
                            <button class="bg-gradient-accent text-white px-3 py-1 rounded-lg text-sm font-semibold hover:shadow-neon transition-colors" onclick="showStreamInfo('${stream.schema}', '${vhost}', '${stream.app}', '${stream.stream}')">查看</button>
                        </td>
                    </tr>
                `;
            });
            
            tbody.innerHTML = html;
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

function formatAliveTime(seconds) {
    if (!seconds || seconds <= 0) {
        return '-';
    }
    
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    let result = '';
    if (days > 0) {
        result += `${days}天`;
    }
    if (hours > 0) {
        result += `${hours}小时`;
    }
    if (minutes > 0) {
        result += `${minutes}分钟`;
    }
    if (secs > 0) {
        result += `${secs}秒`;
    }
    
    return result || '-';
}

function formatBitrate(bytesPerSecond) {
    if (!bytesPerSecond || bytesPerSecond <= 0) {
        return '-';
    }
    
    const kbps = bytesPerSecond / 1024;
    const mbps = kbps / 1024;
    
    if (mbps >= 1) {
        return `${mbps.toFixed(2)} MB/s`;
    } else {
        return `${kbps.toFixed(2)} KB/s`;
    }
}

function generatePlayUrl(app, stream, schema, extraParams) {
    const baseUrl = Api.getBaseUrl();
    let playUrl = '';
    
    if (schema === 'rtmp') {
        playUrl = `${baseUrl}/${app}/${stream}.live.flv`;
    } else if (schema === 'hls') {
        playUrl = `${baseUrl}/${app}/${stream}/hls.m3u8`;
    } else if (schema === 'hls.fmp4') {
        playUrl = `${baseUrl}/${app}/${stream}/hls.fmp4.m3u8`;
    } else if (schema === 'ts') {
        playUrl = `${baseUrl}/${app}/${stream}.live.ts`;
    } else if (schema === 'fmp4') {
        playUrl = `${baseUrl}/${app}/${stream}.live.mp4`;
    } else if (schema === 'rtsp') {
        playUrl = `${baseUrl}/index/api/whep?app=${encodeURIComponent(app)}&stream=${encodeURIComponent(stream)}`;
    } else {
        playUrl = `${baseUrl}/${app}/${stream}.live.flv`;
    }
    
    if (extraParams && typeof extraParams === 'object') {
        const qs = new URLSearchParams(extraParams).toString();
        if (qs) {
            playUrl += (playUrl.includes('?') ? '&' : '?') + qs;
        }
    }
    
    return playUrl;
}

async function fetchPlayUrlParams(app, stream) {
    try {
        const result = await Api.getPluginUrlParams('on_play', app, stream);
        if (result.code === 0 && result.data && Object.keys(result.data).length > 0) {
            return result.data;
        }
    } catch (e) {
        console.warn('获取播放URL附加参数失败，以默认模式播放:', e);
    }
    return null;
}

async function playStream(app, stream, schema) {
    console.log('播放流:', app, stream, schema);
    
    if (schema === 'rtsp') {
        playWithWHEP(app, stream);
    } else if (schema === 'fmp4') {
        const urlParams = await fetchPlayUrlParams(app, stream);
        playWithNative(app, stream, schema, urlParams);
    } else if (schema === 'rtmp') {
        const urlParams = await fetchPlayUrlParams(app, stream);
        playWithJessibuca(app, stream, schema, urlParams);
    } else if (schema === 'hls' || schema === 'hls.fmp4') {
        const urlParams = await fetchPlayUrlParams(app, stream);
        playWithNative(app, stream, schema, urlParams);
    } else if (schema === 'ts') {
        showToast('TS协议暂不支持播放', 'error');
    } else {
        showToast('该协议暂不支持播放', 'error');
    }
}

function playWithNative(app, stream, schema, urlParams) {
    try {
        const modal = document.createElement('div');
        modal.className = 'absolute inset-0 bg-black/80 flex items-center justify-center pointer-events-auto';
        modal.setAttribute('data-modal', 'streams');
        modal.innerHTML = `
            <div class="bg-gray-900 rounded-xl p-6 max-w-4xl w-full mx-4 border border-white/20" onclick="event.stopPropagation()">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-xl font-bold text-white">播放流: ${app}/${stream}</h3>
                    <button class="text-white/60 hover:text-white">
                        <i class="fa fa-times text-2xl"></i>
                    </button>
                </div>
                <div class="aspect-video bg-black rounded-lg overflow-hidden">
                    <video id="nativeVideo" class="w-full h-full" controls autoplay playsinline></video>
                </div>
                <div class="mt-4 text-white/60 text-sm">
                    协议: ${schema.toUpperCase()} | 应用: ${app} | 流: ${stream}
                </div>
            </div>
        `;
        document.getElementById('streams-modal-container').appendChild(modal);
        
        const playUrl = generatePlayUrl(app, stream, schema, urlParams);
        
        console.log('原生播放URL:', playUrl);
        
        const video = document.getElementById('nativeVideo');
        
        let hlsInstance = null;
        
        const destroyPlayer = () => {
            if (hlsInstance) {
                console.log('销毁HLS播放器');
                hlsInstance.destroy();
                const index = hlsInstances.indexOf(hlsInstance);
                if (index > -1) {
                    hlsInstances.splice(index, 1);
                }
                hlsInstance = null;
            }
            if (video && !video.paused) {
                video.pause();
            }
        };
        
        if (schema === 'hls' || schema === 'hls.fmp4') {
            if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = playUrl;
            } else if (typeof Hls !== 'undefined' && Hls.isSupported()) {
                hlsInstance = new Hls();
                hlsInstances.push(hlsInstance);
                hlsInstance.loadSource(playUrl);
                hlsInstance.attachMedia(video);
                hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
                    console.log('HLS manifest解析成功');
                    video.play();
                });
                hlsInstance.on(Hls.Events.ERROR, (event, data) => {
                    console.error('HLS播放错误:', data);
                    showToast('HLS播放错误: ' + data.type, 'error');
                });
            } else {
                showToast('浏览器不支持HLS播放', 'error');
                return;
            }
        } else {
            video.src = playUrl;
        }
        
        video.play().catch(error => {
            console.error('播放失败:', error);
            showToast('播放失败: ' + error.message, 'error');
        });
        
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                destroyPlayer();
                modal.remove();
            }
        });
        
        modal.querySelector('button').addEventListener('click', () => {
            destroyPlayer();
            modal.remove();
        });
        
    } catch (error) {
        console.error('原生播放失败:', error);
        showToast('播放失败: ' + error.message, 'error');
    }
}

async function showStreamInfo(schema, vhost, app, stream) {
    try {
        console.log('获取流信息:', schema, vhost, app, stream);
        
        const result = await Api.getMediaInfo(schema, vhost, app, stream);
        
        if (result.code !== 0) {
            showToast('获取流信息失败: ' + (result.msg || '未知错误'), 'error');
            return;
        }
        
        const data = result;
        
        const modal = document.createElement('div');
        modal.className = 'absolute inset-0 bg-black/80 flex items-center justify-center overflow-y-auto pointer-events-auto';
        modal.setAttribute('data-modal', 'streams');
        modal.innerHTML = `
            <div class="bg-gray-900 rounded-xl p-6 max-w-4xl w-full mx-4 my-8 border border-white/20 flex flex-col" style="max-height:90vh;" onclick="event.stopPropagation()">
                <div class="flex justify-between items-center mb-4 shrink-0">
                    <h3 class="text-xl font-bold text-white">流信息: ${app}/${stream}</h3>
                    <button class="text-white/60 hover:text-white" onclick="this.closest('.absolute').remove()">
                        <i class="fa fa-times text-2xl"></i>
                    </button>
                </div>
                <div class="space-y-4 overflow-y-auto flex-1 min-h-0">
                    <div class="bg-white/5 rounded-lg p-4">
                        <h4 class="text-lg font-semibold text-white mb-3 border-b border-white/10 pb-2">流截图</h4>
                        <div class="flex items-center justify-center h-48 bg-white/5 rounded-lg" id="stream-snap-container">
                            <div class="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
                        </div>
                    </div>
                    <div class="bg-white/5 rounded-lg p-4" id="stream-playurl-container">
                        <h4 class="text-lg font-semibold text-white mb-3 border-b border-white/10 pb-2">播放地址</h4>
                        <div class="flex items-center gap-2 text-sm text-white/40"><i class="fa fa-spinner fa-spin"></i> 加载中...</div>
                    </div>
                    ${renderStreamInfo(data, vhost, app, stream)}
                </div>
                <div class="flex justify-end gap-2 pt-4 mt-2 border-t border-white/10 shrink-0">
                    <button class="bg-purple-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:shadow-neon transition-colors rec-nav-btn" data-vhost="${vhost}" data-app="${app}" data-stream="${stream}"><i class="fa fa-film mr-1"></i>录像</button>
                    <button class="bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:shadow-neon transition-colors" onclick="showStreamPlayers('${schema}', '${vhost}', '${app}', '${stream}')"><i class="fa fa-users mr-1"></i>观众</button>
                    <button class="bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:shadow-neon transition-colors" onclick="stopStream('${schema}', '${vhost}', '${app}', '${stream}')"><i class="fa fa-stop mr-1"></i>停止</button>
                </div>
            </div>
        `;
        document.getElementById('streams-modal-container').appendChild(modal);

        // 录像按钮：通过 data-* 避免引号嵌套问题
        modal.querySelector('.rec-nav-btn')?.addEventListener('click', function() {
            navigateToRecordings(this.dataset.vhost, this.dataset.app, this.dataset.stream);
        });

        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                modal.remove();
            }
        });
        
        // 获取截图并显示
        const snapUrlParams = await fetchPlayUrlParams(app, stream);
        const playUrl = generatePlayUrl(app, stream, schema, snapUrlParams);

        // 截图用 URL：rtsp 改用 rtmp 协议的 flv 地址，并追加 self=1
        const baseUrl = Api.getBaseUrl();
        let snapUrl;
        if (schema === 'rtsp') {
            snapUrl = `${baseUrl}/${app}/${stream}.live.flv`;
            if (snapUrlParams) {
                const qs = new URLSearchParams(snapUrlParams).toString();
                if (qs) snapUrl += '?' + qs;
            }
        } else {
            snapUrl = playUrl;
        }
        snapUrl += (snapUrl.includes('?') ? '&' : '?') + 'self=1';

        // 填充播放地址
        const playUrlContainer = document.getElementById('stream-playurl-container');
        if (playUrlContainer) {
            playUrlContainer.innerHTML = `
                <h4 class="text-lg font-semibold text-white mb-3 border-b border-white/10 pb-2">播放地址</h4>
                <div class="flex items-center gap-2 text-sm">
                    <span class="text-white/80 break-all flex-1 font-mono bg-black/30 rounded px-3 py-2 select-all">${playUrl}</span>
                    <button class="shrink-0 bg-yellow-500 hover:bg-yellow-400 text-white px-3 py-2 rounded-lg font-semibold transition-colors" onclick="navigator.clipboard.writeText('${playUrl.replace(/'/g, "\\'")}').then(()=>showToast('已复制到剪贴板','success')).catch(()=>showToast('复制失败','error'))">
                        <i class="fa fa-copy mr-1"></i>拷贝
                    </button>
                </div>
            `;
        }

        const snapContainer = document.getElementById('stream-snap-container');
        if (snapContainer) {
            await getStreamSnap(snapUrl, snapContainer);
        }
        
    } catch (error) {
        console.error('获取流信息失败:', error);
        showToast('获取流信息失败: ' + error.message, 'error');
    }
}

function renderStreamInfo(data, vhost, app, stream) {
    let html = '';
    
    html += `
        <div class="bg-white/5 rounded-lg p-4">
            <h4 class="text-lg font-semibold text-white mb-3 border-b border-white/10 pb-2">基本信息</h4>
            <div class="grid grid-cols-2 gap-3 text-sm">
                <div><span class="text-white/60">应用:</span> <span class="text-white">${data.app || '-'}</span></div>
                <div><span class="text-white/60">流ID:</span> <span class="text-white">${data.stream || '-'}</span></div>
                <div><span class="text-white/60">协议:</span> <span class="text-white">${data.schema || '-'}</span></div>
                <div><span class="text-white/60">虚拟主机:</span> <span class="text-white">${data.vhost || '-'}</span></div>
                <div><span class="text-white/60">存活时间:</span> <span class="text-white">${data.aliveSecond ? data.aliveSecond + '秒' : '-'}</span></div>
                <div><span class="text-white/60">观众数:</span> <span class="text-white">${data.readerCount || 0}</span></div>
                <div><span class="text-white/60">总观众数:</span> <span class="text-white">${data.totalReaderCount || 0}</span></div>
                <div><span class="text-white/60">码率:</span> <span class="text-white">${data.bytesSpeed ? (data.bytesSpeed / 1024).toFixed(2) + ' KB/s' : '-'}</span></div>
                <div><span class="text-white/60">总流量:</span> <span class="text-white">${data.totalBytes ? (data.totalBytes / 1024 / 1024).toFixed(2) + ' MB' : '-'}</span></div>
                <div><span class="text-white/60">创建时间:</span> <span class="text-white">${data.createStamp ? new Date(data.createStamp * 1000).toLocaleString() : '-'}</span></div>
                <div><span class="text-white/60">当前时间戳:</span> <span class="text-white">${data.currentStamp || '-'}</span></div>
                <div><span class="text-white/60">参数:</span> <span class="text-white break-all">${data.params || '-'}</span></div>
            </div>
        </div>
    `;
    
    if (data.originSock) {
        html += `
            <div class="bg-white/5 rounded-lg p-4">
                <h4 class="text-lg font-semibold text-white mb-3 border-b border-white/10 pb-2">源信息</h4>
                <div class="grid grid-cols-2 gap-3 text-sm">
                    <div><span class="text-white/60">源类型:</span> <span class="text-white">${data.originTypeStr || '-'}</span></div>
                    <div><span class="text-white/60">源类型ID:</span> <span class="text-white">${data.originType || '-'}</span></div>
                    <div><span class="text-white/60">源URL:</span> <span class="text-white break-all">${data.originUrl || '-'}</span></div>
                    <div><span class="text-white/60">本地地址:</span> <span class="text-white">${data.originSock.local_ip}:${data.originSock.local_port}</span></div>
                    <div><span class="text-white/60">远端地址:</span> <span class="text-white">${data.originSock.peer_ip}:${data.originSock.peer_port}</span></div>
                    <div><span class="text-white/60">标识符:</span> <span class="text-white">${data.originSock.identifier || '-'}</span></div>
                </div>
            </div>
        `;
    }
    
    if (data.tracks && data.tracks.length > 0) {
        html += `
            <div class="bg-white/5 rounded-lg p-4">
                <h4 class="text-lg font-semibold text-white mb-3 border-b border-white/10 pb-2">轨道信息</h4>
                <div class="space-y-3">
        `;
        
        data.tracks.forEach((track, index) => {
            const isVideo = track.codec_type === 0;
            html += `
                <div class="bg-white/5 rounded p-3">
                    <div class="font-semibold text-white mb-2">${isVideo ? '视频轨道' : '音频轨道'} #${index + 1}</div>
                    <div class="grid grid-cols-2 gap-2 text-sm">
                        <div><span class="text-white/60">编码:</span> <span class="text-white">${track.codec_id_name || '-'}</span></div>
                        <div><span class="text-white/60">就绪:</span> <span class="text-white">${track.ready ? '是' : '否'}</span></div>
                        ${isVideo ? `
                            <div><span class="text-white/60">分辨率:</span> <span class="text-white">${track.width || '-'}x${track.height || '-'}</span></div>
                            <div><span class="text-white/60">帧率:</span> <span class="text-white">${track.fps || '-'}</span></div>
                            <div><span class="text-white/60">GOP大小:</span> <span class="text-white">${track.gop_size || '-'}</span></div>
                            <div><span class="text-white/60">GOP间隔:</span> <span class="text-white">${track.gop_interval_ms || '-'}ms</span></div>
                            <div><span class="text-white/60">关键帧数:</span> <span class="text-white">${track.key_frames || '-'}</span></div>
                            <div><span class="text-white/60">总帧数:</span> <span class="text-white">${track.frames || '-'}</span></div>
                        ` : `
                            <div><span class="text-white/60">采样率:</span> <span class="text-white">${track.sample_rate || '-'}</span></div>
                            <div><span class="text-white/60">通道数:</span> <span class="text-white">${track.channels || '-'}</span></div>
                            <div><span class="text-white/60">采样位数:</span> <span class="text-white">${track.sample_bit || '-'}</span></div>
                            <div><span class="text-white/60">总帧数:</span> <span class="text-white">${track.frames || '-'}</span></div>
                        `}
                        <div><span class="text-white/60">时长:</span> <span class="text-white">${track.duration ? (track.duration / 1000).toFixed(2) + '秒' : '-'}</span></div>
                        <div><span class="text-white/60">丢包率:</span> <span class="text-white">${track.loss || 0}%</span></div>
                    </div>
                </div>
            `;
        });
        
        html += `
                </div>
            </div>
        `;
    }
    
    if (data.isRecordingHLS !== undefined || data.isRecordingMP4 !== undefined) {
        const hlsRecording = !!data.isRecordingHLS;
        const mp4Recording = !!data.isRecordingMP4;
        const v = vhost, a = app, s = stream;
        html += `
            <div class="bg-white/5 rounded-lg p-4">
                <h4 class="text-lg font-semibold text-white mb-3 border-b border-white/10 pb-2">录制状态</h4>
                <div class="grid grid-cols-2 gap-4 text-sm">
                    <div class="flex items-center gap-3">
                        <span class="text-white/60">HLS:</span>
                        <span class="text-white mr-1">${hlsRecording ? '<span class="text-green-400">录制中</span>' : '<span class="text-white/40">未录制</span>'}</span>
                        ${hlsRecording
                            ? `<button class="bg-red-500 hover:bg-red-400 text-white px-3 py-1 rounded-lg text-xs font-semibold transition-colors" onclick="toggleRecord(0,'${v}','${a}','${s}',false,this)"><i class="fa fa-stop mr-1"></i>停止</button>`
                            : `<button class="bg-green-600 hover:bg-green-500 text-white px-3 py-1 rounded-lg text-xs font-semibold transition-colors" onclick="toggleRecord(0,'${v}','${a}','${s}',true,this)"><i class="fa fa-circle mr-1"></i>开始</button>`
                        }
                    </div>
                    <div class="flex items-center gap-3">
                        <span class="text-white/60">MP4:</span>
                        <span class="text-white mr-1">${mp4Recording ? '<span class="text-green-400">录制中</span>' : '<span class="text-white/40">未录制</span>'}</span>
                        ${mp4Recording
                            ? `<button class="bg-red-500 hover:bg-red-400 text-white px-3 py-1 rounded-lg text-xs font-semibold transition-colors" onclick="toggleRecord(1,'${v}','${a}','${s}',false,this)"><i class="fa fa-stop mr-1"></i>停止</button>`
                            : `<button class="bg-green-600 hover:bg-green-500 text-white px-3 py-1 rounded-lg text-xs font-semibold transition-colors" onclick="toggleRecord(1,'${v}','${a}','${s}',true,this)"><i class="fa fa-circle mr-1"></i>开始</button>`
                        }
                    </div>
                </div>
            </div>
        `;
    }
    
    if (data.transcode && data.transcode.length > 0) {
        html += `
            <div class="bg-white/5 rounded-lg p-4">
                <h4 class="text-lg font-semibold text-white mb-3 border-b border-white/10 pb-2">转码信息</h4>
                <div class="space-y-3">
        `;
        
        data.transcode.forEach((transcode, index) => {
            html += `
                <div class="bg-white/5 rounded p-3">
                    <div class="font-semibold text-white mb-2">转码配置 #${index + 1}</div>
                    <div class="grid grid-cols-2 gap-2 text-sm">
                        <div><span class="text-white/60">视频解码:</span> <span class="text-white">${transcode.vdec || '-'}</span></div>
                        <div><span class="text-white/60">视频编码:</span> <span class="text-white">${transcode.venc || '-'}</span></div>
                        <div><span class="text-white/60">音频解码:</span> <span class="text-white">${transcode.adec || '-'}</span></div>
                        <div><span class="text-white/60">音频编码:</span> <span class="text-white">${transcode.aenc || '-'}</span></div>
                        <div><span class="text-white/60">名称:</span> <span class="text-white">${transcode.name || '-'}</span></div>
                    </div>
            `;
            
            if (transcode.setting) {
                html += `
                    <div class="mt-2 pt-2 border-t border-white/10">
                        <div class="text-white/80 font-semibold mb-1">转码设置</div>
                        <div class="grid grid-cols-2 gap-2 text-sm">
                            <div><span class="text-white/60">目标视频编码:</span> <span class="text-white">${transcode.setting.target_vcodec || '-'}</span></div>
                            <div><span class="text-white/60">目标音频编码:</span> <span class="text-white">${transcode.setting.target_acodec || '-'}</span></div>
                            <div><span class="text-white/60">视频解码线程:</span> <span class="text-white">${transcode.setting.vdecoder_threads || '-'}</span></div>
                            <div><span class="text-white/60">视频编码线程:</span> <span class="text-white">${transcode.setting.vencoder_threads || '-'}</span></div>
                            <div><span class="text-white/60">音频解码线程:</span> <span class="text-white">${transcode.setting.adecoder_threads || '-'}</span></div>
                            <div><span class="text-white/60">音频编码线程:</span> <span class="text-white">${transcode.setting.aencoder_threads || '-'}</span></div>
                            <div><span class="text-white/60">滤镜线程:</span> <span class="text-white">${transcode.setting.filter_threads || '-'}</span></div>
                            <div><span class="text-white/60">滤镜:</span> <span class="text-white">${transcode.setting.filter || '-'}</span></div>
                            <div><span class="text-white/60">硬件解码:</span> <span class="text-white">${transcode.setting.hw_decoder ? '是' : '否'}</span></div>
                            <div><span class="text-white/60">硬件编码:</span> <span class="text-white">${transcode.setting.hw_encoder ? '是' : '否'}</span></div>
                            <div><span class="text-white/60">强制转码:</span> <span class="text-white">${transcode.setting.force ? '是' : '否'}</span></div>
                        </div>
                    </div>
                `;
            }
            
            if (transcode.venc_ctx) {
                html += `
                    <div class="mt-2 pt-2 border-t border-white/10">
                        <div class="text-white/80 font-semibold mb-1">视频编码参数</div>
                        <div class="grid grid-cols-2 gap-2 text-sm">
                            <div><span class="text-white/60">分辨率:</span> <span class="text-white">${transcode.venc_ctx.width || '-'}x${transcode.venc_ctx.height || '-'}</span></div>
                            <div><span class="text-white/60">帧率:</span> <span class="text-white">${transcode.venc_ctx.fps || '-'}</span></div>
                            <div><span class="text-white/60">码率:</span> <span class="text-white">${transcode.venc_ctx.bit_rate || '-'}</span></div>
                            <div><span class="text-white/60">GOP:</span> <span class="text-white">${transcode.venc_ctx.gop || '-'}</span></div>
                            <div><span class="text-white/60">像素格式:</span> <span class="text-white">${transcode.venc_ctx.pix_fmt || '-'}</span></div>
                            <div><span class="text-white/60">B帧数:</span> <span class="text-white">${transcode.venc_ctx.has_b_frames || '-'}</span></div>
                        </div>
                    </div>
                `;
            }
            
            if (transcode.aenc_ctx) {
                html += `
                    <div class="mt-2 pt-2 border-t border-white/10">
                        <div class="text-white/80 font-semibold mb-1">音频编码参数</div>
                        <div class="grid grid-cols-2 gap-2 text-sm">
                            <div><span class="text-white/60">采样率:</span> <span class="text-white">${transcode.aenc_ctx.sample_rate || '-'}</span></div>
                            <div><span class="text-white/60">通道数:</span> <span class="text-white">${transcode.aenc_ctx.channels || '-'}</span></div>
                            <div><span class="text-white/60">码率:</span> <span class="text-white">${transcode.aenc_ctx.bit_rate || '-'}</span></div>
                            <div><span class="text-white/60">帧大小:</span> <span class="text-white">${transcode.aenc_ctx.frame_size || '-'}</span></div>
                            <div><span class="text-white/60">采样格式:</span> <span class="text-white">${transcode.aenc_ctx.sample_fmt || '-'}</span></div>
                        </div>
                    </div>
                `;
            }
            
            html += `</div>`;
        });
        
        html += `
                </div>
            </div>
        `;
    }
    
    return html;
}

async function playWithWHEP(app, stream) {
    try {
        const modal = document.createElement('div');
        modal.className = 'absolute inset-0 bg-black/80 flex items-center justify-center pointer-events-auto';
        modal.setAttribute('data-modal', 'streams');
        modal.innerHTML = `
            <div class="bg-gray-900 rounded-xl p-6 max-w-4xl w-full mx-4 border border-white/20" onclick="event.stopPropagation()">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-xl font-bold text-white">播放流: ${app}/${stream}</h3>
                    <button class="text-white/60 hover:text-white" onclick="this.closest('.absolute').remove()">
                        <i class="fa fa-times text-2xl"></i>
                    </button>
                </div>
                <div class="aspect-video bg-black rounded-lg overflow-hidden">
                    <video id="whepVideo" class="w-full h-full" controls autoplay playsinline></video>
                </div>
                <div class="mt-4 text-white/60 text-sm">
                    协议: WHEP (WebRTC) | 应用: ${app} | 流: ${stream}
                </div>
            </div>
        `;
        document.getElementById('streams-modal-container').appendChild(modal);
        
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                modal.remove();
            }
        });
        
        const video = document.getElementById('whepVideo');
        
        const peerConnection = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' }
            ]
        });
        
        peerConnection.addTransceiver('video', { direction: 'recvonly' });
        peerConnection.addTransceiver('audio', { direction: 'recvonly' });
        
        peerConnection.ontrack = (event) => {
            console.log('收到远程轨道:', event.track.kind);
            if (video.srcObject === null) {
                video.srcObject = new MediaStream();
            }
            video.srcObject.addTrack(event.track);
        };
        
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        const whepUrlParams = await fetchPlayUrlParams(app, stream);
        const whepUrl = generatePlayUrl(app, stream, 'rtsp', whepUrlParams);
        console.log('发送WHEP请求到:', whepUrl);
        
        const response = await fetch(whepUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/sdp'
            },
            body: offer.sdp,
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error(`WHEP服务器返回错误: ${response.status}`);
        }
        
        const answerSDP = await response.text();
        await peerConnection.setRemoteDescription(new RTCSessionDescription({
            type: 'answer',
            sdp: answerSDP
        }));
        
        console.log('WHEP播放成功');
        
        modal.querySelector('button').addEventListener('click', () => {
            peerConnection.close();
            video.srcObject = null;
        });
        
    } catch (error) {
        console.error('WHEP播放失败:', error);
        showToast('播放失败: ' + error.message, 'error');
    }
}

function playWithJessibuca(app, stream, schema, urlParams) {
    try {
        const modal = document.createElement('div');
        modal.className = 'absolute inset-0 bg-black/80 flex items-center justify-center pointer-events-auto';
        modal.setAttribute('data-modal', 'streams');
        modal.innerHTML = `
            <div class="bg-gray-900 rounded-xl p-6 max-w-4xl w-full mx-4 border border-white/20" onclick="event.stopPropagation()">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-xl font-bold text-white">播放流: ${app}/${stream}</h3>
                    <button class="text-white/60 hover:text-white" onclick="this.closest('.absolute').remove()">
                        <i class="fa fa-times text-2xl"></i>
                    </button>
                </div>
                <div class="aspect-video bg-black rounded-lg overflow-hidden">
                    <div id="jessibucaContainer" class="w-full h-full"></div>
                </div>
                <div class="mt-4 text-white/60 text-sm">
                    协议: ${schema.toUpperCase()} | 应用: ${app} | 流: ${stream}
                </div>
            </div>
        `;
        document.getElementById('streams-modal-container').appendChild(modal);
        
        const playUrl = generatePlayUrl(app, stream, schema, urlParams);
        
        console.log('Jessibuca播放URL:', playUrl);
        
        let jessibucaInstance = null;
        
        const destroyPlayer = () => {
            if (jessibucaInstance) {
                console.log('销毁Jessibuca播放器');
                jessibucaInstance.destroy();
                const index = jessibucaInstances.indexOf(jessibucaInstance);
                if (index > -1) {
                    jessibucaInstances.splice(index, 1);
                }
                jessibucaInstance = null;
            }
        };
        
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                destroyPlayer();
                modal.remove();
            }
        });
        
        if (window.Jessibuca) {
            jessibucaInstance = initJessibucaPlayer(playUrl, modal, destroyPlayer);
        } else {
            const script = document.createElement('script');
            script.src = 'js/lib/jessibuca.js';
            script.onload = () => {
                console.log('Jessibuca播放器加载成功');
                jessibucaInstance = initJessibucaPlayer(playUrl, modal, destroyPlayer);
            };
            script.onerror = () => {
                console.error('加载Jessibuca播放器失败');
                showToast('加载播放器失败', 'error');
            };
            document.head.appendChild(script);
        }
        
    } catch (error) {
        console.error('Jessibuca播放失败:', error);
        showToast('播放失败: ' + error.message, 'error');
    }
}

function initJessibucaPlayer(playUrl, modal, destroyCallback) {
    try {
        const jessibuca = new window.Jessibuca({
            container: document.getElementById('jessibucaContainer'),
            videoBuffer: 0.5,
            isResize: true,
            loadingText: '加载中...',
            hasAudio: true,
            hasVideo: true,
            debug: true,
            supportDblclickFullscreen: true,
            showBandwidth: true,
            operateBtns: {
                fullscreen: true,
                screenshot: true,
                play: true,
                audio: true
            },
            forceNoOffscreen: true,
            isNotMute: true,
            timeout: 10,
            heartTimeout: 10,
            heartTimeoutReplay: true,
            heartTimeoutReplayTimes: 3,
            wasmDecodeErrorReplay: true,
            decoder: 'js/lib/decoder.js'
        });
        
        jessibuca.on('play', () => {
            console.log('Jessibuca开始播放');
        });
        
        jessibuca.on('pause', () => {
            console.log('Jessibuca暂停播放');
        });
        
        jessibuca.on('error', (error) => {
            console.error('Jessibuca播放错误:', error);
            showToast('播放错误: ' + JSON.stringify(error), 'error');
        });
        
        jessibuca.on('timeout', () => {
            console.error('Jessibuca播放超时');
            showToast('播放超时，请检查流地址', 'error');
        });
        
        console.log('开始播放:', playUrl);
        jessibuca.play(playUrl);
        
        jessibucaInstances.push(jessibuca);
        
        modal.querySelector('button').addEventListener('click', () => {
            if (destroyCallback) {
                destroyCallback();
            }
        });
        
        return jessibuca;
    } catch (error) {
        console.error('初始化Jessibuca播放器失败:', error);
        showToast('初始化播放器失败: ' + error.message, 'error');
        return null;
    }
}

function showConfirmModal(title, message, onConfirm, onCancel) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50';
    modal.innerHTML = `
        <div class="bg-gray-900 rounded-xl p-6 max-w-md w-full mx-4 border border-white/20" id="confirmModalContent">
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-xl font-bold text-white">${title}</h3>
                <button class="text-white/60 hover:text-white" id="confirmModalClose">
                    <i class="fa fa-times text-2xl"></i>
                </button>
            </div>
            <p class="text-white/80 mb-6">${message}</p>
            <div class="flex justify-end space-x-3">
                <button class="bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-600 transition-colors" id="confirmModalCancel">取消</button>
                <button class="bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:shadow-neon transition-colors" id="confirmModalConfirm">确认</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    // 添加事件监听器
    document.getElementById('confirmModalClose').addEventListener('click', function() {
        modal.remove();
    });
    
    document.getElementById('confirmModalCancel').addEventListener('click', function() {
        modal.remove();
        if (typeof onCancel === 'function') {
            onCancel();
        }
    });
    
    document.getElementById('confirmModalConfirm').addEventListener('click', function() {
        modal.remove();
        if (typeof onConfirm === 'function') {
            onConfirm();
        }
    });
    
    document.getElementById('confirmModalContent').addEventListener('click', function(e) {
        e.stopPropagation();
    });
    
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

async function showStreamPlayers(schema, vhost, app, stream) {
    try {
        console.log('获取播放器列表:', schema, vhost, app, stream);
        
        const result = await Api.getMediaPlayerList(schema, vhost, app, stream);
        
        if (result.code !== 0) {
            showToast('获取播放器列表失败: ' + (result.msg || '未知错误'), 'error');
            return;
        }
        
        const players = result.data || [];
        
        const modal = document.createElement('div');
        modal.className = 'absolute inset-0 bg-black/80 flex items-center justify-center overflow-y-auto pointer-events-auto';
        modal.setAttribute('data-modal', 'streams');
        
        let playersHtml = '';
        if (players.length === 0) {
            playersHtml = `
                <div class="p-8 text-center text-white/60">
                    暂无播放器连接
                </div>
            `;
        } else {
            playersHtml = `
                <div class="space-y-4">
                    ${players.map((player, index) => `
                        <div class="bg-white/5 rounded-lg p-4">
                            <div class="grid grid-cols-2 gap-3 text-sm">
                                <div><span class="text-white/60">标识符:</span> <span class="text-white">${player.identifier || '-'}</span></div>
                                <div><span class="text-white/60">类型:</span> <span class="text-white">${player.typeid || '-'}</span></div>
                                <div><span class="text-white/60">本地IP:</span> <span class="text-white">${player.local_ip || '-'}</span></div>
                                <div><span class="text-white/60">本地端口:</span> <span class="text-white">${player.local_port || '-'}</span></div>
                                <div><span class="text-white/60">远端IP:</span> <span class="text-white">${player.peer_ip || '-'}</span></div>
                                <div><span class="text-white/60">远端端口:</span> <span class="text-white">${player.peer_port || '-'}</span></div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        }
        
        modal.innerHTML = `
            <div class="bg-gray-900 rounded-xl p-6 max-w-4xl w-full mx-4 my-8 border border-white/20" onclick="event.stopPropagation()">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-xl font-bold text-white">播放器列表: ${app}/${stream}</h3>
                    <button class="text-white/60 hover:text-white" onclick="this.closest('.absolute').remove()">
                        <i class="fa fa-times text-2xl"></i>
                    </button>
                </div>
                <div class="max-h-[70vh] overflow-y-auto">
                    ${playersHtml}
                </div>
            </div>
        `;
        document.getElementById('streams-modal-container').appendChild(modal);
        
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                modal.remove();
            }
        });
        
    } catch (error) {
        console.error('获取播放器列表失败:', error);
        showToast('获取播放器列表失败: ' + error.message, 'error');
    }
}

async function getStreamSnap(url, container) {
    try {
        console.log('获取截图:', url);
        
        // 显示加载状态
        container.innerHTML = `
            <div class="flex items-center justify-center h-full bg-white/5 rounded-lg">
                <div class="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
            </div>
        `;
        
        // 调用getSnap接口获取截图
        const result = await Api.getSnap(url, 5, 3);
        
        if (result.code === 0 && result.data) {
            // 显示截图
            container.innerHTML = `
                <div class="relative flex items-center justify-center h-full">
                    <img src="${result.data}" alt="流截图" class="max-w-full max-h-full object-contain rounded-lg border border-white/20 cursor-pointer hover:opacity-90 transition-opacity" onclick="showSnapModal('${result.data}')">
                    <div class="absolute bottom-2 right-2 flex space-x-1">
                        <button class="bg-blue-500 text-white px-2 py-1 rounded text-xs font-semibold hover:bg-blue-600 transition-colors" onclick="downloadSnap('${result.data}')">
                            <i class="fa fa-download mr-1"></i>下载
                        </button>
                    </div>
                </div>
            `;
        } else {
            // 显示错误状态
            container.innerHTML = `
                <div class="flex items-center justify-center h-full bg-white/5 rounded-lg">
                    <span class="text-white/60 text-sm">获取失败</span>
                </div>
            `;
        }
    } catch (error) {
        console.error('获取截图失败:', error);
        // 显示错误状态
        container.innerHTML = `
            <div class="flex items-center justify-center h-full bg-white/5 rounded-lg">
                <span class="text-white/60 text-sm">获取失败</span>
            </div>
        `;
    }
}

function downloadSnap(imageUrl) {
    // 创建一个临时链接并点击下载
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = `stream-snap-${Date.now()}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function showSnapModal(imageUrl) {
    // 创建弹窗显示放大的截图
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/90 flex items-center justify-center z-50';
    modal.innerHTML = `
        <div class="bg-gray-900 rounded-xl p-6 max-w-4xl w-full mx-4 border border-white/20" onclick="event.stopPropagation()">
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-xl font-bold text-white">流截图</h3>
                <button class="text-white/60 hover:text-white" onclick="this.closest('.fixed').remove()">
                    <i class="fa fa-times text-2xl"></i>
                </button>
            </div>
            <div class="flex justify-center">
                <img src="${imageUrl}" alt="流截图" class="max-w-full max-h-[70vh] object-contain rounded-lg">
            </div>
            <div class="mt-4 flex justify-end">
                <button class="bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:shadow-neon transition-colors" onclick="downloadSnap('${imageUrl}')">
                    <i class="fa fa-download mr-2"></i>下载截图
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    // 点击弹窗外部关闭
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

async function copyStreamUrl(app, stream, schema) {
    const urlParams = await fetchPlayUrlParams(app, stream);
    const url = generatePlayUrl(app, stream, schema, urlParams);
    try {
        await navigator.clipboard.writeText(url);
        showToast('地址已拷贝到剪贴板', 'success');
    } catch (e) {
        // 降级方案
        const input = document.createElement('input');
        input.value = url;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        showToast('地址已拷贝到剪贴板', 'success');
    }
}

async function toggleRecord(type, vhost, app, stream, start, btn) {
    // type: 0=hls, 1=mp4; start: true=开始录制, false=停止录制
    const typeName = type === 0 ? 'HLS' : 'MP4';
    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa fa-spinner fa-spin mr-1"></i>处理中...';
        let result;
        if (start) {
            result = await Api.startRecord(type, vhost, app, stream);
        } else {
            result = await Api.stopRecord(type, vhost, app, stream);
        }
        if (result.code === 0 && result.result !== false) {
            showToast(`${typeName}录制已${start ? '开始' : '停止'}`, 'success');
            // 切换按钮状态
            const isNowRecording = start;
            btn.className = isNowRecording
                ? 'bg-red-500 hover:bg-red-400 text-white px-3 py-1 rounded-lg text-xs font-semibold transition-colors'
                : 'bg-green-600 hover:bg-green-500 text-white px-3 py-1 rounded-lg text-xs font-semibold transition-colors';
            btn.innerHTML = isNowRecording
                ? '<i class="fa fa-stop mr-1"></i>停止'
                : '<i class="fa fa-circle mr-1"></i>开始';
            btn.setAttribute('onclick', `toggleRecord(${type},'${vhost}','${app}','${stream}',${!isNowRecording},this)`);
            btn.disabled = false;
            // 更新状态文字
            const statusSpan = btn.parentElement.querySelector('span.text-white span');
            if (statusSpan) {
                statusSpan.className = isNowRecording ? 'text-green-400' : 'text-white/40';
                statusSpan.textContent = isNowRecording ? '录制中' : '未录制';
            }
        } else {
            showToast(`${typeName}录制${start ? '开始' : '停止'}失败: ${result.msg || '未知错误'}`, 'error');
            btn.disabled = false;
            btn.innerHTML = start
                ? '<i class="fa fa-circle mr-1"></i>开始'
                : '<i class="fa fa-stop mr-1"></i>停止';
        }
    } catch (error) {
        showToast(`操作失败: ${error.message}`, 'error');
        btn.disabled = false;
    }
}

async function stopStream(schema, vhost, app, stream) {
    // 显示自定义确认弹窗
    showConfirmModal(
        '确认停止流',
        `确定要停止流 ${app}/${stream} 吗？`,
        async function() {
            try {
                console.log('停止流:', schema, vhost, app, stream);
                
                const result = await Api.closeStream(schema, vhost, app, stream);
                
                if (result.code === 0) {
                    showToast('停止流成功', 'success');
                    // 重新加载流列表
                    loadStreams();
                } else {
                    showToast('停止流失败: ' + (result.msg || '未知错误'), 'error');
                }
            } catch (error) {
                console.error('停止流失败:', error);
                showToast('停止流失败: ' + error.message, 'error');
            }
        }
    );
}
