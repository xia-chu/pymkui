document.addEventListener('DOMContentLoaded', async function() {
    const isAuth = await checkAuth();
    if (!isAuth) {
        return;
    }

    initTabs();
    initNavigation();
    await initLogout();
    
    addTab('dashboard', '状态概览', 'fa-dashboard');
});

let tabs = [];
let activeTab = null;

const pageNames = {
    'dashboard': '状态概览',
    'streams': '视频管理',
    'pull-proxy': '拉流代理',
    'settings': '服务配置',
    'whip': '在线推流',
    'network': '连接管理',
    'protocol-options': '协议配置'
};

const pageIcons = {
    'dashboard': 'fa-dashboard',
    'streams': 'fa-video-camera',
    'pull-proxy': 'fa-cloud-download',
    'settings': 'fa-cog',
    'whip': 'fa-podcast',
    'network': 'fa-link',
    'protocol-options': 'fa-cogs'
};

function initTabs() {
    tabs = [];
    activeTab = null;
    renderTabs();
}

function addTab(pageName, title, icon) {
    const existingTab = tabs.find(tab => tab.pageName === pageName);
    if (existingTab) {
        switchTab(pageName);
        return;
    }
    
    tabs.push({
        pageName: pageName,
        title: title || pageNames[pageName] || pageName,
        icon: icon || pageIcons[pageName] || 'fa-file'
    });
    
    switchTab(pageName);
    renderTabs();
}

/**
 * 跳转到视频管理页面，并自动应用 vhost/app/stream 筛选
 * @param {string} vhost  虚拟主机，如 __defaultVhost__
 * @param {string} app    应用名
 * @param {string} stream 流ID
 */
function navigateToStreams(vhost, app, stream) {
    // 把筛选参数暂存，loadStreamsPage 初始化完成后读取
    window._pendingStreamsFilter = { vhost: vhost || '', app: app || '', stream: stream || '' };

    const existingTab = tabs.find(tab => tab.pageName === 'streams');
    if (existingTab) {
        // 页面已存在：switchTab 会调用 loadPageData → loadStreamsPage 重新加载内容
        switchTab('streams');
    } else {
        // 页面不存在：addTab 触发 switchTab → loadStreamsPage
        addTab('streams', '视频管理', 'fa-video-camera');
    }
}

function switchTab(pageName) {
    activeTab = pageName;
    
    const pages = document.querySelectorAll('.page');
    pages.forEach(page => {
        page.classList.add('hidden');
    });
    
    const targetPage = document.getElementById(pageName + '-page');
    if (targetPage) {
        targetPage.classList.remove('hidden');
    }
    
    const menuItems = document.querySelectorAll('nav ul li a');
    menuItems.forEach(menu => {
        const menuItemPage = menu.getAttribute('data-page');
        if (menuItemPage === pageName) {
            menu.classList.remove('border-transparent', 'text-white/80');
            menu.classList.add('border-primary', 'bg-white/5', 'text-white');
        } else {
            menu.classList.remove('border-primary', 'bg-white/5', 'text-white');
            menu.classList.add('border-transparent', 'text-white/80');
        }
    });
    
    loadPageData(pageName);
    renderTabs();
}

function closeTab(pageName, event) {
    if (event) {
        event.stopPropagation();
    }
    
    const tabIndex = tabs.findIndex(tab => tab.pageName === pageName);
    if (tabIndex === -1) return;
    
    // 清理模态框和播放器
    if (pageName === 'streams' && typeof cleanupStreamsPage === 'function') {
        cleanupStreamsPage();
    } else if (pageName === 'pull-proxy' && typeof cleanupPullProxyPage === 'function') {
        cleanupPullProxyPage();
    } else if (pageName === 'protocol-options') {
        const protocolOptionsModalContainer = document.getElementById('protocol-options-modal-container');
        if (protocolOptionsModalContainer) {
            protocolOptionsModalContainer.innerHTML = '';
        }
    } else if (pageName === 'plugins') {
        // 清理提升到 body 的插件弹窗
        ['bindingModal', 'paramsModal'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });
    } else if (pageName === 'whip' && typeof whipState !== 'undefined' && whipState.isStreaming) {
        console.log('关闭whip标签页，停止推流...');
        stopWhipStream();
    } else if (pageName === 'dashboard' && typeof cleanupDashboard === 'function') {
        console.log('关闭dashboard标签页，清理资源...');
        cleanupDashboard();
    }
    
    tabs.splice(tabIndex, 1);
    
    if (activeTab === pageName) {
        if (tabs.length > 0) {
            const newActiveIndex = Math.min(tabIndex, tabs.length - 1);
            switchTab(tabs[newActiveIndex].pageName);
        } else {
            activeTab = null;
        }
    }
    
    renderTabs();
}

function renderTabs() {
    const tabsContainer = document.getElementById('tabs');
    if (!tabsContainer) return;
    
    let html = '';
    tabs.forEach(tab => {
        const isActive = tab.pageName === activeTab;
        html += `
            <div class="flex items-center px-4 py-2 rounded-t-lg cursor-pointer transition-all duration-300 ${isActive ? 'bg-white/10 text-white border-b-2 border-primary' : 'text-white/60 hover:text-white hover:bg-white/5'}" 
                 onclick="switchTab('${tab.pageName}')">
                <i class="fa ${tab.icon} mr-2"></i>
                <span class="mr-2">${tab.title}</span>
                ${tabs.length > 1 ? `<button class="ml-1 hover:bg-white/20 rounded-full w-5 h-5 flex items-center justify-center" onclick="closeTab('${tab.pageName}', event)">
                    <i class="fa fa-times text-xs"></i>
                </button>` : ''}
            </div>
        `;
    });
    
    tabsContainer.innerHTML = html;
}

function loadPageData(pageName) {
    switch (pageName) {
        case 'dashboard':
            loadDashboardPage();
            break;
        case 'streams':
            loadStreamsPage();
            break;
        case 'pull-proxy':
            loadPullProxyPage();
            break;
        case 'settings':
            loadSettingsPage();
            break;
        case 'whip':
            loadWhipPage();
            break;
        case 'network':
            loadNetworkPage();
            break;
        case 'protocol-options':
            loadProtocolOptionsPage();
            break;
        case 'plugins':
            loadPluginsPage();
            break;
        case 'recordings':
            loadRecordingsPageWrapper();
            break;
        default:
            break;
    }
}

async function loadDashboardPage() {
    const content = document.getElementById('dashboard-content');
    console.log('开始加载dashboard页面...');
    
    content.innerHTML = `
        <div class="flex justify-center items-center h-64">
            <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto mb-4"></div>
            <span class="text-white/60 font-semibold">加载中...</span>
        </div>
    `;
    
    try {
        console.log('正在获取dashboard.html文件...');
        const response = await fetch('pages/dashboard.html');
        console.log('dashboard.html文件获取成功，状态:', response.status);
        
        if (response.ok) {
            const html = await response.text();
            console.log('dashboard.html文件内容长度:', html.length);
            content.innerHTML = html;
            console.log('dashboard.html文件内容已加载到页面');
            
            setTimeout(() => {
                console.log('开始初始化dashboard功能...');
                if (typeof initDashboard === 'function') {
                    initDashboard();
                } else {
                    console.error('initDashboard函数未定义');
                }
            }, 100);
        } else {
            console.error('加载dashboard.html文件失败，状态:', response.status);
            content.innerHTML = `
                <div class="text-center p-10 text-white/60 font-semibold">
                    加载状态概览页面失败
                </div>
            `;
        }
    } catch (error) {
        console.error('加载dashboard页面时发生错误:', error);
        content.innerHTML = `
            <div class="text-center p-10 text-white/60 font-semibold">
                网络错误: ${error.message}
            </div>
        `;
    }
}

async function loadStreamsPage() {
    const content = document.getElementById('streams-content');
    console.log('开始加载streams页面...');
    
    content.innerHTML = `
        <div class="flex justify-center items-center h-64">
            <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto mb-4"></div>
            <span class="text-white/60 font-semibold">加载中...</span>
        </div>
    `;
    
    try {
        console.log('正在获取streams.html文件...');
        const response = await fetch('pages/streams.html');
        console.log('streams.html文件获取成功，状态:', response.status);
        
        if (response.ok) {
            const html = await response.text();
            console.log('streams.html文件内容长度:', html.length);
            content.innerHTML = html;
            console.log('streams.html文件内容已加载到页面');
            
            setTimeout(() => {
                console.log('开始初始化streams功能...');
                if (typeof loadStreams === 'function') {
                    // 若有待填充的跳转筛选参数，先应用
                    if (window._pendingStreamsFilter) {
                        const f = window._pendingStreamsFilter;
                        window._pendingStreamsFilter = null;
                        const vhostEl = document.getElementById('vhostFilter');
                        const appEl = document.getElementById('appFilter');
                        const streamEl = document.getElementById('streamFilter');
                        if (vhostEl && f.vhost !== undefined) vhostEl.value = f.vhost;
                        if (appEl && f.app !== undefined) appEl.value = f.app;
                        if (streamEl && f.stream !== undefined) streamEl.value = f.stream;
                    }
                    loadStreams();
                    
                    const vhostFilter = document.getElementById('vhostFilter');
                    if (vhostFilter) {
                        vhostFilter.addEventListener('input', loadStreams);
                        console.log('Vhost筛选事件监听器已绑定');
                    }
                    
                    const protocolFilter = document.getElementById('protocolFilter');
                    if (protocolFilter) {
                        protocolFilter.addEventListener('change', loadStreams);
                        console.log('协议筛选事件监听器已绑定');
                    }
                    
                    const appFilter = document.getElementById('appFilter');
                    if (appFilter) {
                        appFilter.addEventListener('input', loadStreams);
                    }
                    
                    const streamFilter = document.getElementById('streamFilter');
                    if (streamFilter) {
                        streamFilter.addEventListener('input', loadStreams);
                    }
                    
                    const refreshButton = document.getElementById('refreshStreams');
                    if (refreshButton) {
                        refreshButton.addEventListener('click', loadStreams);
                        console.log('刷新按钮事件监听器已绑定');
                    }
                } else {
                    console.error('loadStreams函数未定义');
                }
            }, 100);
        } else {
            console.error('加载streams.html文件失败，状态:', response.status);
            content.innerHTML = `
                <div class="text-center p-10 text-white/60 font-semibold">
                    加载视频管理页面失败
                </div>
            `;
        }
    } catch (error) {
        console.error('加载streams页面时发生错误:', error);
        content.innerHTML = `
            <div class="text-center p-10 text-white/60 font-semibold">
                网络错误: ${error.message}
            </div>
        `;
    }
}

async function loadPullProxyPage() {
    const content = document.getElementById('pull-proxy-content');
    console.log('开始加载pull-proxy页面...');
    
    content.innerHTML = `
        <div class="flex justify-center items-center h-64">
            <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto mb-4"></div>
            <span class="text-white/60 font-semibold">加载中...</span>
        </div>
    `;
    
    try {
        console.log('正在获取pull-proxy.html文件...');
        const response = await fetch('pages/pull-proxy.html');
        console.log('pull-proxy.html文件获取成功，状态:', response.status);
        
        if (response.ok) {
            const html = await response.text();
            console.log('pull-proxy.html文件内容长度:', html.length);
            content.innerHTML = html;
            console.log('pull-proxy.html文件内容已加载到页面');
            
            setTimeout(() => {
                console.log('开始初始化pull-proxy功能...');
                if (typeof loadPullProxyList === 'function') {
                    loadPullProxyList();
                } else {
                    console.error('loadPullProxyList函数未定义');
                }
            }, 100);
        } else {
            console.error('加载pull-proxy.html文件失败，状态:', response.status);
            content.innerHTML = `
                <div class="text-center p-10 text-white/60 font-semibold">
                    加载拉流代理页面失败
                </div>
            `;
        }
    } catch (error) {
        console.error('加载pull-proxy页面时发生错误:', error);
        content.innerHTML = `
            <div class="text-center p-10 text-white/60 font-semibold">
                网络错误: ${error.message}
            </div>
        `;
    }
}


async function loadSettingsPage() {
    const content = document.getElementById('settings-content');
    console.log('开始加载settings页面...');
    
    content.innerHTML = `
        <div class="flex justify-center items-center h-64">
            <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto mb-4"></div>
            <span class="text-white/60 font-semibold">加载中...</span>
        </div>
    `;
    
    try {
        console.log('正在获取settings.html文件...');
        const response = await fetch('pages/settings.html');
        console.log('settings.html文件获取成功，状态:', response.status);
        
        if (response.ok) {
            const html = await response.text();
            console.log('settings.html文件内容长度:', html.length);
            content.innerHTML = html;
            console.log('settings.html文件内容已加载到页面');
            
            setTimeout(() => {
                console.log('开始初始化settings功能...');
                if (typeof initSettingsPage === 'function') {
                    initSettingsPage();
                } else {
                    console.error('initSettingsPage函数未定义');
                }
            }, 100);
        } else {
            console.error('加载settings.html文件失败，状态:', response.status);
            content.innerHTML = `
                <div class="text-center p-10 text-white/60 font-semibold">
                    加载服务配置页面失败
                </div>
            `;
        }
    } catch (error) {
        console.error('加载settings页面时发生错误:', error);
        content.innerHTML = `
            <div class="text-center p-10 text-white/60 font-semibold">
                网络错误: ${error.message}
            </div>
        `;
    }
}

async function loadWhipPage() {
    const content = document.getElementById('whip-content');
    console.log('开始加载whip页面...');
    
    if (typeof whipState !== 'undefined' && whipState.initialized) {
        console.log('whip页面已初始化，恢复状态...');
        if (typeof restoreWhipState === 'function') {
            restoreWhipState();
        }
        return;
    }
    
    content.innerHTML = `
        <div class="flex justify-center items-center h-64">
            <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto mb-4"></div>
            <span class="text-white/60 font-semibold">加载中...</span>
        </div>
    `;
    
    try {
        console.log('正在获取whip.html文件...');
        const response = await fetch('pages/whip.html');
        console.log('whip.html文件获取成功，状态:', response.status);
        
        if (response.ok) {
            const html = await response.text();
            console.log('whip.html文件内容长度:', html.length);
            content.innerHTML = html;
            console.log('whip.html文件内容已加载到页面');
            
            setTimeout(() => {
                console.log('开始初始化whip推流功能...');
                if (typeof initWhipStreaming === 'function') {
                    initWhipStreaming();
                    if (typeof whipState !== 'undefined') {
                        whipState.initialized = true;
                    }
                } else {
                    console.error('initWhipStreaming函数未定义');
                }
            }, 100);
        } else {
            console.error('加载whip.html文件失败，状态:', response.status);
            content.innerHTML = `
                <div class="text-center p-10 text-white/60 font-semibold">
                    加载在线推流页面失败
                </div>
            `;
        }
    } catch (error) {
        console.error('加载whip页面时发生错误:', error);
        content.innerHTML = `
            <div class="text-center p-10 text-white/60 font-semibold">
                网络错误: ${error.message}
            </div>
        `;
    }
}

async function loadNetworkPage() {
    const content = document.getElementById('network-content');
    console.log('开始加载network页面...');
    
    content.innerHTML = `
        <div class="flex justify-center items-center h-64">
            <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto mb-4"></div>
            <span class="text-white/60 font-semibold">加载中...</span>
        </div>
    `;
    
    try {
        console.log('正在获取network.html文件...');
        const response = await fetch('pages/network.html');
        console.log('network.html文件获取成功，状态:', response.status);
        
        if (response.ok) {
            const html = await response.text();
            console.log('network.html文件内容长度:', html.length);
            content.innerHTML = html;
            console.log('network.html文件内容已加载到页面');
            
            setTimeout(() => {
                console.log('开始初始化network功能...');
                if (typeof initNetwork === 'function') {
                    initNetwork();
                } else {
                    console.error('initNetwork函数未定义');
                }
            }, 100);
        } else {
            console.error('加载network.html文件失败，状态:', response.status);
            content.innerHTML = `
                <div class="text-center p-10 text-white/60 font-semibold">
                    加载网络链接页面失败
                </div>
            `;
        }
    } catch (error) {
        console.error('加载network页面时发生错误:', error);
        content.innerHTML = `
            <div class="text-center p-10 text-white/60 font-semibold">
                网络错误: ${error.message}
            </div>
        `;
    }
}

async function loadProtocolOptionsPage() {
    console.log('loadProtocolOptionsPage函数被调用');
    const content = document.getElementById('protocol-options-content');
    console.log('找到protocol-options-content元素:', content);
    if (!content) {
        console.error('protocol-options-content元素不存在');
        return;
    }
    console.log('开始加载protocol-options页面...');
    
    content.innerHTML = `
        <div class="flex justify-center items-center h-64">
            <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto mb-4"></div>
            <span class="text-white/60 font-semibold">加载中...</span>
        </div>
    `;
    
    try {
        console.log('正在获取protocol-options.html文件...');
        const response = await fetch('pages/protocol-options.html');
        console.log('protocol-options.html文件获取成功，状态:', response.status);
        
        if (response.ok) {
            const html = await response.text();
            console.log('protocol-options.html文件内容长度:', html.length);
            content.innerHTML = html;
            console.log('protocol-options.html文件内容已加载到页面');
            
            setTimeout(() => {
                console.log('开始初始化protocol-options功能...');
                console.log('loadProtocolOptions函数是否存在:', typeof loadProtocolOptions === 'function');
                if (typeof loadProtocolOptions === 'function') {
                    console.log('调用loadProtocolOptions函数');
                    loadProtocolOptions();
                } else {
                    console.error('loadProtocolOptions函数未定义');
                }
            }, 100);
        } else {
            console.error('加载protocol-options.html文件失败，状态:', response.status);
            content.innerHTML = `
                <div class="text-center p-10 text-white/60 font-semibold">
                    加载协议配置页面失败
                </div>
            `;
        }
    } catch (error) {
        console.error('加载protocol-options页面时发生错误:', error);
        content.innerHTML = `
            <div class="text-center p-10 text-white/60 font-semibold">
                网络错误: ${error.message}
            </div>
        `;
    }
}

function initNavigation() {
    const menuItems = document.querySelectorAll('nav ul li a');

    menuItems.forEach(item => {
        if (item.id === 'logoutBtn') {
            return;
        }
        
        item.addEventListener('click', function(e) {
            e.preventDefault();
            
            const pageName = this.getAttribute('data-page');
            const title = this.querySelector('span').textContent;
            const iconClass = this.querySelector('i').className.split(' ').find(cls => cls.startsWith('fa-'));
            
            addTab(pageName, title, iconClass);
        });
    });
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

async function initLogout() {
    document.getElementById('logoutBtn').addEventListener('click', async function() {
        showConfirmModal(
            '确认退出登录',
            '确定要退出登录吗？',
            async function() {
                try {
                    await Api.logout();
                    Api.clearAuth();
                    showToast('已退出登录', 'info');
                    setTimeout(() => {
                        window.location.href = 'login.html';
                    }, 1000);
                } catch (error) {
                    showToast('退出登录失败: ' + error.message, 'error');
                }
            }
        );
    });
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toast-message');
    const toastIcon = toast.querySelector('i');
    
    toastMessage.textContent = message;
    
    switch (type) {
        case 'success':
            toastIcon.className = 'fa fa-check-circle';
            break;
        case 'error':
            toastIcon.className = 'fa fa-exclamation-circle';
            break;
        case 'warning':
            toastIcon.className = 'fa fa-exclamation-triangle';
            break;
        default:
            toastIcon.className = 'fa fa-info-circle';
    }
    
    toast.className = 'fixed top-4 right-4 z-50 transition-all duration-500 transform translate-x-full opacity-0';
    
    let bgClass = '';
    switch (type) {
        case 'success':
            bgClass = 'bg-gradient-to-r from-green-400 to-emerald-500';
            break;
        case 'error':
            bgClass = 'bg-gradient-to-r from-rose-500 to-red-500';
            break;
        case 'warning':
            bgClass = 'bg-gradient-to-r from-amber-400 to-yellow-500';
            break;
        default:
            bgClass = 'bg-gradient-primary';
    }
    
    toast.classList.add(...bgClass.split(' '));
    
    setTimeout(() => {
        toast.classList.remove('translate-x-full', 'opacity-0');
    }, 100);
    
    setTimeout(() => {
        toast.classList.add('translate-x-full', 'opacity-0');
    }, 3000);
}

async function loadPluginsPage() {
    const content = document.getElementById('plugins-content');
    if (!content) return;

    content.innerHTML = `
        <div class="flex justify-center items-center h-64">
            <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto"></div>
        </div>`;

    try {
        const response = await fetch('pages/plugins.html');
        if (response.ok) {
            const html = await response.text();
            content.innerHTML = html;
            // 把所有插件弹窗提升到 body，避免父容器 pointer-events-none / overflow 干扰
            ['bindingModal', 'paramsModal'].forEach(id => {
                const el = document.getElementById(id);
                if (el) document.body.appendChild(el);
            });
            setTimeout(() => {
                if (typeof initPluginsPage === 'function') initPluginsPage();
            }, 100);
        } else {
            content.innerHTML = `<div class="text-center p-10 text-white/60">加载插件管理页面失败</div>`;
        }
    } catch (e) {
        content.innerHTML = `<div class="text-center p-10 text-white/60">网络错误: ${e.message}</div>`;
    }
}

async function loadRecordingsPageWrapper() {
    const content = document.getElementById('recordings-content');
    if (!content) return;
    if (!content.dataset.loaded) {
        const resp = await fetch('pages/recordings.html');
        content.innerHTML = resp.ok ? await resp.text() : '<div class="text-white/40 p-10 text-center">加载失败</div>';
        content.dataset.loaded = '1';
    }
    if (typeof loadRecordingsPage === 'function') loadRecordingsPage();
}
