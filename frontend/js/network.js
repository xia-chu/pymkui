async function loadNetwork() {
    const tbody = document.getElementById('networkTableBody');
    
    tbody.innerHTML = `
        <tr>
            <td colspan="8" class="p-10 text-center">
                <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto mb-4"></div>
                <span class="text-white/60 font-semibold">加载中...</span>
            </td>
        </tr>
    `;
    
    try {
        const result = await Api.getNetworkList();
        
        console.log('getNetworkList返回结果:', result);
        
        if (result.code === 0) {
            const data = result.data || [];
            
            console.log('网络链接列表数据:', data);
            
            if (data.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="8" class="p-10 text-center text-white/60 font-semibold">
                            暂无网络链接
                        </td>
                    </tr>
                `;
                return;
            }
            
            let html = '';
            data.forEach(network => {
                console.log('网络链接数据:', network);
                
                html += `
                    <tr class="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td class="p-4 text-white">${network.identifier || network.id || '-'}</td>
                        <td class="p-4 text-white">${network.typeid || '-'}</td>
                        <td class="p-4 text-white">${network.type || '-'}</td>
                        <td class="p-4 text-white">${network.local_ip || '-'}</td>
                        <td class="p-4 text-white">${network.local_port || '-'}</td>
                        <td class="p-4 text-white">${network.peer_ip || '-'}</td>
                        <td class="p-4 text-white">${network.peer_port || '-'}</td>
                        <td class="p-4">
                            <button class="bg-red-500 text-white px-3 py-1 rounded-lg text-sm font-semibold hover:shadow-neon transition-colors" onclick="closeNetwork('${network.identifier || network.id}')">关闭</button>
                        </td>
                    </tr>
                `;
            });
            
            tbody.innerHTML = html;
        } else {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" class="p-10 text-center text-white/60 font-semibold">
                        加载失败: ${result.msg || '未知错误'}
                    </td>
                </tr>
            `;
        }
    } catch (error) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="p-10 text-center text-white/60 font-semibold">
                    网络错误: ${error.message}
                </td>
            </tr>
        `;
    }
}

async function closeNetwork(identifier) {
    // 显示确认弹窗
    showConfirmModal(
        '确认关闭链接',
        `确定要关闭标识符为 ${identifier} 的网络链接吗？`,
        async function() {
            try {
                console.log('关闭网络链接:', identifier);
                
                // 关闭网络链接的API调用
                const result = await Api.request('/index/api/kick_session', { body: { id: identifier } });
                
                if (result.code === 0) {
                    showToast('关闭网络链接成功', 'success');
                    // 重新加载网络链接列表
                    loadNetwork();
                } else {
                    showToast('关闭网络链接失败: ' + (result.msg || '未知错误'), 'error');
                }
            } catch (error) {
                console.error('关闭网络链接失败:', error);
                showToast('关闭网络链接失败: ' + error.message, 'error');
            }
        }
    );
}

// 初始化网络链接页面
function initNetwork() {
    // 首次加载数据
    loadNetwork();
    
    // 绑定刷新按钮事件
    const refreshBtn = document.getElementById('refreshNetwork');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', loadNetwork);
    }
}

// 清理网络链接页面资源
function cleanupNetwork() {
    // 移除事件监听器等资源
    const refreshBtn = document.getElementById('refreshNetwork');
    if (refreshBtn) {
        // 移除事件监听器
        const newRefreshBtn = refreshBtn.cloneNode(true);
        refreshBtn.parentNode.replaceChild(newRefreshBtn, refreshBtn);
        newRefreshBtn.addEventListener('click', loadNetwork);
    }
}