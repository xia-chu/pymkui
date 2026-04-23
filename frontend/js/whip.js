let whipState = {
    localStream: null,
    peerConnection: null,
    sessionId: '',
    whipUrl: '',
    locationUrl: '',
    isStreaming: false,
    initialized: false
};

async function stopWhipStream() {
    try {
        if (whipState.locationUrl) {
            console.log('发送WHIP停止请求到:', whipState.locationUrl);
            await fetch(whipState.locationUrl, {
                method: 'DELETE',
                credentials: 'include'
            });
            whipState.locationUrl = '';
            whipState.sessionId = '';
        }
        
        if (whipState.localStream) {
            whipState.localStream.getTracks().forEach(track => track.stop());
            whipState.localStream = null;
            const localVideo = document.getElementById('localVideo');
            if (localVideo) {
                localVideo.srcObject = null;
            }
        }
        
        if (whipState.peerConnection) {
            whipState.peerConnection.close();
            whipState.peerConnection = null;
        }
        
        whipState.isStreaming = false;
        
        const startStreamBtn = document.getElementById('startStream');
        const stopStreamBtn = document.getElementById('stopStream');
        if (startStreamBtn) {
            startStreamBtn.disabled = false;
        }
        if (stopStreamBtn) {
            stopStreamBtn.disabled = true;
        }
        
        console.log('推流已停止');
        
    } catch (error) {
        console.error('停止推流失败:', error);
    }
}

function restoreWhipState() {
    const localVideo = document.getElementById('localVideo');
    const startStreamBtn = document.getElementById('startStream');
    const stopStreamBtn = document.getElementById('stopStream');
    
    if (whipState.localStream && localVideo) {
        localVideo.srcObject = whipState.localStream;
        console.log('恢复本地预览成功');
    }
    
    if (startStreamBtn && stopStreamBtn) {
        startStreamBtn.disabled = whipState.isStreaming;
        stopStreamBtn.disabled = !whipState.isStreaming;
        console.log('恢复按钮状态成功，推流状态:', whipState.isStreaming);
    }
    
    const whipUrlInput = document.getElementById('whipUrl');
    if (whipUrlInput && whipState.whipUrl) {
        whipUrlInput.value = whipState.whipUrl;
    }
}

function initWhipStreaming() {
    console.log('Whip streaming initialized');
    
    const updateWhipUrl = async () => {
        const appName = document.getElementById('appName').value || 'live';
        const streamName = document.getElementById('streamName').value || 'test';
        const baseUrl = Api.getBaseUrl();
        const apiPath = '/index/api/whip';
        let url = `${baseUrl}${apiPath}?app=${encodeURIComponent(appName)}&stream=${encodeURIComponent(streamName)}`;
        try {
            const result = await Api.getPluginUrlParams('on_publish', appName, streamName);
            if (result.code === 0 && result.data && Object.keys(result.data).length > 0) {
                url += '&' + new URLSearchParams(result.data).toString();
            }
        } catch (e) {
            console.warn('获取推流URL附加参数失败，使用默认地址:', e);
        }
        whipState.whipUrl = url;
        document.getElementById('whipUrl').value = whipState.whipUrl;
        console.log('更新推流地址:', whipState.whipUrl);
    };
    
    const initDeviceSelection = async () => {
        try {
            let devices = await navigator.mediaDevices.enumerateDevices();
            
            const hasPermission = devices.some(device => device.label);
            
            if (!hasPermission) {
                console.log('没有设备权限，显示提示信息');
                const videoSelect = document.getElementById('videoDevice');
                const audioSelect = document.getElementById('audioDevice');
                
                videoSelect.innerHTML = '<option value="">点击开始推流后授权</option>';
                audioSelect.innerHTML = '<option value="">点击开始推流后授权</option>';
                return;
            }
            
            const videoSelect = document.getElementById('videoDevice');
            videoSelect.innerHTML = '<option value="">选择摄像头</option>';
            
            let firstVideoDeviceId = '';
            devices.forEach(device => {
                if (device.kind === 'videoinput') {
                    const option = document.createElement('option');
                    option.value = device.deviceId;
                    option.text = device.label || `摄像头 ${videoSelect.options.length}`;
                    videoSelect.appendChild(option);
                    
                    if (!firstVideoDeviceId) {
                        firstVideoDeviceId = device.deviceId;
                    }
                }
            });
            
            const audioSelect = document.getElementById('audioDevice');
            audioSelect.innerHTML = '<option value="">选择麦克风</option>';
            
            let firstAudioDeviceId = '';
            devices.forEach(device => {
                if (device.kind === 'audioinput') {
                    const option = document.createElement('option');
                    option.value = device.deviceId;
                    option.text = device.label || `麦克风 ${audioSelect.options.length}`;
                    audioSelect.appendChild(option);
                    
                    if (!firstAudioDeviceId) {
                        firstAudioDeviceId = device.deviceId;
                    }
                }
            });
            
            if (firstVideoDeviceId) {
                videoSelect.value = firstVideoDeviceId;
                console.log('自动选择视频设备:', firstVideoDeviceId);
            }
            
            if (firstAudioDeviceId) {
                audioSelect.value = firstAudioDeviceId;
                console.log('自动选择音频设备:', firstAudioDeviceId);
            }
            
        } catch (error) {
            console.error('设备枚举失败:', error);
            showToast('无法枚举设备', 'error');
        }
    };
    
    const startStream = async () => {
        try {
            console.log('开始推流...');
            
            let videoDevice = document.getElementById('videoDevice').value;
            let audioDevice = document.getElementById('audioDevice').value;
            
            if (!videoDevice || videoDevice === '点击开始推流后授权') {
                console.log('请求媒体设备权限...');
                try {
                    const tempStream = await navigator.mediaDevices.getUserMedia({ 
                        video: true, 
                        audio: true 
                    });
                    tempStream.getTracks().forEach(track => track.stop());
                    
                    await initDeviceSelection();
                    
                    videoDevice = document.getElementById('videoDevice').value;
                    audioDevice = document.getElementById('audioDevice').value;
                    
                    if (!videoDevice || videoDevice === '点击开始推流后授权') {
                        showToast('请选择视频设备', 'error');
                        return;
                    }
                } catch (error) {
                    console.error('获取设备权限失败:', error);
                    showToast('无法访问摄像头或麦克风，请检查权限设置', 'error');
                    return;
                }
            }
            
            console.log('使用视频设备:', videoDevice, '音频设备:', audioDevice);
            
            console.log('正在获取本地媒体流...');
            whipState.localStream = await navigator.mediaDevices.getUserMedia({
                video: { deviceId: videoDevice ? { exact: videoDevice } : true },
                audio: audioDevice ? { deviceId: { exact: audioDevice } } : true
            });
            console.log('成功获取本地媒体流，轨道数:', whipState.localStream.getTracks().length);
            
            const localVideo = document.getElementById('localVideo');
            localVideo.srcObject = whipState.localStream;
            console.log('本地预览已显示');
            
            console.log('正在创建PeerConnection...');
            whipState.peerConnection = new RTCPeerConnection({
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' }
                ]
            });
            
            whipState.peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    console.log('生成ICE候选:', event.candidate);
                }
            };
            
            whipState.peerConnection.onconnectionstatechange = () => {
                console.log('PeerConnection状态:', whipState.peerConnection.connectionState);
            };
            
            whipState.localStream.getTracks().forEach(track => {
                console.log('添加轨道到PeerConnection:', track.kind);
                whipState.peerConnection.addTrack(track, whipState.localStream);
            });
            
            console.log('正在生成SDP offer...');
            const offer = await whipState.peerConnection.createOffer();
            console.log('SDP offer生成成功');
            await whipState.peerConnection.setLocalDescription(offer);
            console.log('本地SDP设置成功');
            
            console.log('发送WHIP请求到:', whipState.whipUrl);
            console.log('SDP内容长度:', offer.sdp.length);
            const response = await fetch(whipState.whipUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/sdp'
                },
                body: offer.sdp,
                credentials: 'include'
            });
            
            console.log('WHIP服务器响应状态:', response.status);
            console.log('WHIP服务器响应头:', Object.fromEntries(response.headers.entries()));
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('WHIP服务器返回错误内容:', errorText);
                throw new Error(`WHIP服务器返回错误: ${response.status} - ${errorText}`);
            }
            
            const location = response.headers.get('Location');
            console.log('Location头:', location);
            if (!location) {
                throw new Error('WHIP服务器未返回Location头');
            }
            
            whipState.locationUrl = location;
            
            whipState.sessionId = location.split('/').pop();
            console.log('获取到session ID:', whipState.sessionId);
            console.log('保存Location URL:', whipState.locationUrl);
            
            const answerSDP = await response.text();
            console.log('SDP answer长度:', answerSDP.length);
            await whipState.peerConnection.setRemoteDescription(new RTCSessionDescription({
                type: 'answer',
                sdp: answerSDP
            }));
            console.log('远程SDP设置成功');
            
            whipState.isStreaming = true;
            
            document.getElementById('startStream').disabled = true;
            document.getElementById('stopStream').disabled = false;
            showToast('推流已开始', 'success');
            console.log('推流已成功开始');
            
        } catch (error) {
            console.error('开始推流失败:', error);
            showToast('开始推流失败: ' + error.message, 'error');
            if (whipState.localStream) {
                whipState.localStream.getTracks().forEach(track => track.stop());
                whipState.localStream = null;
            }
            if (whipState.peerConnection) {
                whipState.peerConnection.close();
                whipState.peerConnection = null;
            }
            whipState.isStreaming = false;
        }
    };
    
    const stopStream = async () => {
        await stopWhipStream();
        showToast('推流已停止', 'success');
    };
    
    const initEventListeners = () => {
        console.log('开始初始化事件监听器...');
        
        const appNameInput = document.getElementById('appName');
        const streamNameInput = document.getElementById('streamName');
        
        if (appNameInput) {
            appNameInput.addEventListener('input', updateWhipUrl);
            console.log('绑定appName输入事件监听器成功');
        } else {
            console.error('未找到appName元素');
        }
        
        if (streamNameInput) {
            streamNameInput.addEventListener('input', updateWhipUrl);
            console.log('绑定streamName输入事件监听器成功');
        } else {
            console.error('未找到streamName元素');
        }
        
        const startStreamBtn = document.getElementById('startStream');
        if (startStreamBtn) {
            startStreamBtn.addEventListener('click', startStream);
            console.log('绑定startStream按钮点击事件监听器成功');
        } else {
            console.error('未找到startStream按钮');
        }
        
        const stopStreamBtn = document.getElementById('stopStream');
        if (stopStreamBtn) {
            stopStreamBtn.addEventListener('click', stopStream);
            console.log('绑定stopStream按钮点击事件监听器成功');
        } else {
            console.error('未找到stopStream按钮');
        }
        
        console.log('事件监听器初始化完成');
    };
    
    updateWhipUrl();
    initDeviceSelection();
    initEventListeners();
}
