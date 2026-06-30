async function loadDashboard() {
    try {
        // 并行获取数据，提高性能
        const [statisticResult, mediaResult, versionResult, threadsLoadResult, workThreadsLoadResult, hostStatsResult] = await Promise.all([
            Api.getStatistic(),
            Api.getMediaList(),
            Api.getVersion(),
            Api.getThreadsLoad(),
            Api.getWorkThreadsLoad(),
            Api.getHostStats()
        ]);
        
        // 处理统计数据
        if (statisticResult.code === 0) {
            const statisticData = statisticResult.data || {};
            // 使用MultiMediaSourceMuxer个数作为在线流数
            const streamCount = statisticData.MultiMediaSourceMuxer || 0;
            document.getElementById('streamCount').textContent = streamCount;
            
            // 绘制统计图表
            drawStatisticChart(statisticData);
        } else {
            document.getElementById('streamCount').textContent = '0';
        }
        
        // 处理媒体列表数据
        if (mediaResult.code === 0) {
            const mediaData = mediaResult.data || [];
            let totalViewers = 0;
            mediaData.forEach(stream => {
                totalViewers += stream.readerCount || 0;
            });
            document.getElementById('viewerCount').textContent = totalViewers;
        } else {
            document.getElementById('viewerCount').textContent = '0';
        }
        
        // 处理版本信息
        if (versionResult.code === 0) {
            const data = versionResult.data || {};
            const branchName = data.branchName || '-';
            const buildTime = data.buildTime || '-';
            const commitHash = data.commitHash || '-';
            document.getElementById('versionInfo').textContent = `服务版本: ${commitHash}`;
            document.getElementById('branchInfo').textContent = `分支: ${branchName}`;
            document.getElementById('buildInfo').textContent = `编译时间: ${buildTime}`;
        } else {
            document.getElementById('versionInfo').textContent = '服务版本: -';
            document.getElementById('branchInfo').textContent = '分支: -';
            document.getElementById('buildInfo').textContent = '编译时间: -';
        }
        
        // 处理线程负载数据
        if (threadsLoadResult.code === 0) {
            const data = threadsLoadResult.data || [];
            drawThreadsLoadChart(data);
        }
        
        // 处理工作线程负载数据
        if (workThreadsLoadResult.code === 0) {
            const data = workThreadsLoadResult.data || [];
            drawWorkThreadsLoadChart(data);
        }
        
        // 处理系统资源数据
        if (hostStatsResult.code === 0) {
            const data = hostStatsResult.data || {};
            
            // 更新流量统计
            const network = data.network || {};
            const sentTotal = network.sent_total || 0;
            const recvTotal = network.recv_total || 0;
            document.getElementById('trafficCount').innerHTML = `
                <p class="text-white/70 text-xs">发送: ${formatBytes(sentTotal * 1024)}</p>
                <p class="text-white/70 text-xs mt-1">接收: ${formatBytes(recvTotal * 1024)}</p>
            `;
            
            // 更新历史数据
            updateHistoryData(data);
            
            // 绘制图表
            drawCpuMemoryChart(data.memory || {});
            drawDiskChart(data.disk || {});
            drawNetworkChart(data.network || {});
        } else {
            showToast('加载系统状态失败: ' + hostStatsResult.msg, 'error');
        }
    } catch (error) {
        showToast('加载数据失败: ' + error.message, 'error');
        document.getElementById('streamCount').textContent = '0';
        document.getElementById('viewerCount').textContent = '0';
        document.getElementById('versionInfo').textContent = '服务版本: -';
        document.getElementById('branchInfo').textContent = '分支: -';
        document.getElementById('buildInfo').textContent = '编译时间: -';
    }
}

// 存储定时器ID
let dashboardTimer = null;

// 初始化dashboard，在dashboard.html加载完成后调用
function initDashboard() {
    // 首次加载数据
    loadDashboard();
    
    // 清除之前的定时器
    if (dashboardTimer) {
        clearInterval(dashboardTimer);
    }
    
    // 设置3秒刷新一次状态
    dashboardTimer = setInterval(loadDashboard, 3000);
}

// 清理dashboard资源
function cleanupDashboard() {
    if (dashboardTimer) {
        clearInterval(dashboardTimer);
        dashboardTimer = null;
    }
}

function drawStatisticChart(data) {
    const ctx = document.getElementById('statisticChart').getContext('2d');
    
    const labels = Object.keys(data);
    const values = Object.values(data);
    
    if (window.statisticChart && typeof window.statisticChart.destroy === 'function') {
        window.statisticChart.destroy();
    }
    
    window.statisticChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: '对象个数',
                data: values,
                backgroundColor: 'rgba(75, 192, 192, 0.7)',
                borderColor: 'rgba(75, 192, 192, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: {
                    top: 20
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.8)'
                    }
                },
                x: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.8)',
                        rotation: 45
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                }
            }
        }
    });
}

function drawThreadsLoadChart(data) {
    const ctx = document.getElementById('threadsLoadChart').getContext('2d');
    
    const labels = data.map(item => item.name || '未命名');
    const loadData = data.map(item => (item.load || 0));
    const delayData = data.map(item => item.delay || 0);
    const fdCountData = data.map(item => item.fd_count || 0);
    
    const maxDelay = Math.max(...delayData, 100);
    const yMax = maxDelay > 100 ? maxDelay * 1.2 : 100;
    
    const maxFdCount = Math.max(...fdCountData, 1);
    const fdCountScaled = fdCountData.map(val => (val / maxFdCount) * 90);
    
    if (window.threadsLoadChart && typeof window.threadsLoadChart.destroy === 'function') {
        window.threadsLoadChart.destroy();
    }
    
    window.threadsLoadChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: '负载',
                    data: loadData,
                    type: 'line',
                    backgroundColor: 'rgba(54, 162, 235, 0.2)',
                    borderColor: 'rgba(54, 162, 235, 1)',
                    borderWidth: 2,
                    tension: 0.4,
                    fill: true,
                    yAxisID: 'y1',
                    pointRadius: 3,
                    pointHoverRadius: 5
                },
                {
                    label: '延迟',
                    data: delayData,
                    type: 'line',
                    backgroundColor: 'rgba(255, 206, 86, 0.2)',
                    borderColor: 'rgba(255, 206, 86, 1)',
                    borderWidth: 2,
                    tension: 0.4,
                    fill: true,
                    yAxisID: 'y',
                    pointRadius: 3,
                    pointHoverRadius: 5
                },
                {
                    label: 'FD数量',
                    data: fdCountScaled,
                    type: 'line',
                    backgroundColor: 'rgba(153, 102, 255, 0.2)',
                    borderColor: 'rgba(153, 102, 255, 1)',
                    borderWidth: 2,
                    tension: 0.4,
                    fill: true,
                    yAxisID: 'y1',
                    pointRadius: 3,
                    pointHoverRadius: 5
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: {
                    top: 30
                }
            },
            scales: {
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: '延迟',
                        color: 'rgba(255, 255, 255, 0.8)'
                    },
                    beginAtZero: true,
                    max: yMax,
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.8)',
                        callback: function(value) {
                            return value + ' ms';
                        }
                    }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: {
                        display: true,
                        text: '负载',
                        color: 'rgba(255, 255, 255, 0.8)'
                    },
                    beginAtZero: true,
                    max: 110,
                    grid: {
                        drawOnChartArea: false
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.8)',
                        callback: function(value) {
                            return value + ' %';
                        }
                    }
                },
                x: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.8)',
                        rotation: 45
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        color: 'rgba(255, 255, 255, 0.8)'
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            if (context.dataset.label === 'FD数量') {
                                return 'FD数量: ' + fdCountData[context.dataIndex];
                            }
                            return context.dataset.label + ': ' + context.parsed.y;
                        }
                    }
                }
            },
            animation: {
                onComplete: function() {
                    const chart = this;
                    const ctx = chart.ctx;
                    
                    chart.data.datasets.forEach(function(dataset, i) {
                        if (dataset.label === 'FD数量') {
                            const meta = chart.getDatasetMeta(i);
                            meta.data.forEach(function(point, index) {
                                const data = fdCountData[index];
                                ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
                                ctx.font = '10px Inter, system-ui, sans-serif';
                                ctx.textAlign = 'center';
                                ctx.textBaseline = 'bottom';
                                ctx.fillText(data, point.x, point.y - 5);
                            });
                        }
                    });
                }
            }
        }
    });
}

function drawWorkThreadsLoadChart(data) {
    const ctx = document.getElementById('workThreadsLoadChart').getContext('2d');
    
    const labels = data.map(item => item.name || '未命名');
    const loadData = data.map(item => (item.load || 0));
    const delayData = data.map(item => item.delay || 0);
    const fdCountData = data.map(item => item.fd_count || 0);
    
    const maxDelay = Math.max(...delayData, 100);
    const yMax = maxDelay > 100 ? maxDelay * 1.2 : 100;
    
    const maxFdCount = Math.max(...fdCountData, 1);
    const fdCountScaled = fdCountData.map(val => (val / maxFdCount) * 90);
    
    if (window.workThreadsLoadChart && typeof window.workThreadsLoadChart.destroy === 'function') {
        window.workThreadsLoadChart.destroy();
    }
    
    window.workThreadsLoadChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: '负载',
                    data: loadData,
                    type: 'line',
                    backgroundColor: 'rgba(54, 162, 235, 0.2)',
                    borderColor: 'rgba(54, 162, 235, 1)',
                    borderWidth: 2,
                    tension: 0.4,
                    fill: true,
                    yAxisID: 'y1',
                    pointRadius: 3,
                    pointHoverRadius: 5
                },
                {
                    label: '延迟',
                    data: delayData,
                    type: 'line',
                    backgroundColor: 'rgba(255, 206, 86, 0.2)',
                    borderColor: 'rgba(255, 206, 86, 1)',
                    borderWidth: 2,
                    tension: 0.4,
                    fill: true,
                    yAxisID: 'y',
                    pointRadius: 3,
                    pointHoverRadius: 5
                },
                {
                    label: 'FD数量',
                    data: fdCountScaled,
                    type: 'line',
                    backgroundColor: 'rgba(153, 102, 255, 0.2)',
                    borderColor: 'rgba(153, 102, 255, 1)',
                    borderWidth: 2,
                    tension: 0.4,
                    fill: true,
                    yAxisID: 'y1',
                    pointRadius: 3,
                    pointHoverRadius: 5
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: {
                    top: 30
                }
            },
            scales: {
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: '延迟',
                        color: 'rgba(255, 255, 255, 0.8)'
                    },
                    beginAtZero: true,
                    max: yMax,
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.8)',
                        callback: function(value) {
                            return value + ' ms';
                        }
                    }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: {
                        display: true,
                        text: '负载',
                        color: 'rgba(255, 255, 255, 0.8)'
                    },
                    beginAtZero: true,
                    max: 110,
                    grid: {
                        drawOnChartArea: false
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.8)',
                        callback: function(value) {
                            return value + ' %';
                        }
                    }
                },
                x: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.8)',
                        rotation: 45
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        color: 'rgba(255, 255, 255, 0.8)'
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            if (context.dataset.label === 'FD数量') {
                                return 'FD数量: ' + fdCountData[context.dataIndex];
                            }
                            return context.dataset.label + ': ' + context.parsed.y;
                        }
                    }
                }
            },
            animation: {
                onComplete: function() {
                    const chart = this;
                    const ctx = chart.ctx;
                    
                    chart.data.datasets.forEach(function(dataset, i) {
                        if (dataset.label === 'FD数量') {
                            const meta = chart.getDatasetMeta(i);
                            meta.data.forEach(function(point, index) {
                                const data = fdCountData[index];
                                ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
                                ctx.font = '10px Inter, system-ui, sans-serif';
                                ctx.textAlign = 'center';
                                ctx.textBaseline = 'bottom';
                                ctx.fillText(data, point.x, point.y - 5);
                            });
                        }
                    });
                }
            }
        }
    });
}

// 存储历史数据
let cpuHistory = Array(30).fill(0);
let memoryHistory = Array(30).fill(0);
let diskHistory = Array(30).fill(0);
let networkSentHistory = Array(30).fill(0);
let networkRecvHistory = Array(30).fill(0);
let timeLabels = Array(30).fill('');

// 格式化字节数单位
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function updateHistoryData(data) {
    // 更新时间标签
    const time = data.time || '';
    timeLabels.shift();
    timeLabels.push(time);
    
    // 更新CPU数据
    const cpu = data.cpu || 0;
    cpuHistory.shift();
    cpuHistory.push(cpu);
    
    // 更新内存数据
    const memoryUsed = data.memory?.used || 0;
    memoryHistory.shift();
    memoryHistory.push(memoryUsed);
    
    // 更新磁盘数据
    const diskUsed = data.disk?.used || 0;
    diskHistory.shift();
    diskHistory.push(diskUsed);
    
    // 更新网络数据
    const networkSent = data.network?.sent || 0;
    networkSentHistory.shift();
    networkSentHistory.push(networkSent);
    
    const networkRecv = data.network?.recv || 0;
    networkRecvHistory.shift();
    networkRecvHistory.push(networkRecv);
}

// 格式化存储单位
function formatStorage(value) {
    if (value >= 1024) {
        return {
            value: value / 1024,
            unit: 'TB'
        };
    }
    return {
        value: value,
        unit: 'GB'
    };
}

function drawCpuMemoryChart(memoryData = {}) {
    const ctx = document.getElementById('cpuMemoryChart').getContext('2d');
    
    const totalMemory = memoryData.total || 24;
    const formattedMemory = formatStorage(totalMemory);
    const maxMemory = Math.ceil(formattedMemory.value * 1.2);
    
    // 格式化内存历史数据
    const formattedMemoryHistory = memoryHistory.map(value => {
        if (formattedMemory.unit === 'TB') {
            return value / 1024;
        }
        return value;
    });
    
    if (window.cpuMemoryChart && typeof window.cpuMemoryChart.destroy === 'function') {
        window.cpuMemoryChart.destroy();
    }
    
    window.cpuMemoryChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: timeLabels,
            datasets: [{
                label: 'CPU使用率',
                data: cpuHistory,
                borderColor: 'rgba(75, 192, 192, 1)',
                backgroundColor: 'rgba(75, 192, 192, 0.2)',
                tension: 0.4,
                fill: true,
                yAxisID: 'y'
            }, {
                label: `内存使用 (${formattedMemory.unit})`,
                data: formattedMemoryHistory,
                borderColor: 'rgba(54, 162, 235, 1)',
                backgroundColor: 'rgba(54, 162, 235, 0.2)',
                tension: 0.4,
                fill: true,
                yAxisID: 'y1'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    beginAtZero: true,
                    max: 100,
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.8)',
                        callback: function(value) {
                            return value + ' %';
                        }
                    }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    beginAtZero: true,
                    max: maxMemory,
                    grid: {
                        drawOnChartArea: false
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.8)',
                        callback: function(value) {
                            return Math.round(value) + ' ' + formattedMemory.unit;
                        }
                    }
                },
                x: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.8)'
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        color: 'rgba(255, 255, 255, 0.8)'
                    }
                }
            }
        }
    });
}

function drawDiskChart(diskData = {}) {
    const ctx = document.getElementById('diskChart').getContext('2d');
    
    const totalDisk = diskData.total || 500;
    const formattedDisk = formatStorage(totalDisk);
    const maxDisk = Math.ceil(formattedDisk.value * 1.2);
    
    // 格式化磁盘历史数据
    const formattedDiskHistory = diskHistory.map(value => {
        if (formattedDisk.unit === 'TB') {
            return value / 1024;
        }
        return value;
    });
    
    if (window.diskChart && typeof window.diskChart.destroy === 'function') {
        window.diskChart.destroy();
    }
    
    window.diskChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: timeLabels,
            datasets: [{
                label: `磁盘使用 (${formattedDisk.unit})`,
                data: formattedDiskHistory,
                borderColor: 'rgba(255, 99, 132, 1)',
                backgroundColor: 'rgba(255, 99, 132, 0.2)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    max: maxDisk,
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.8)',
                        callback: function(value) {
                            return Math.round(value) + ' ' + formattedDisk.unit;
                        }
                    }
                },
                x: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.8)'
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        color: 'rgba(255, 255, 255, 0.8)'
                    }
                }
            }
        }
    });
}

// 格式化网络速率单位
function formatNetworkSpeed(value) {
    if (value >= 1024 * 1024) {
        return {
            value: value / (1024 * 1024),
            unit: 'GB/s'
        };
    } else if (value >= 1024) {
        return {
            value: value / 1024,
            unit: 'MB/s'
        };
    }
    return {
        value: value,
        unit: 'KB/s'
    };
}

function drawNetworkChart(networkData = {}) {
    const ctx = document.getElementById('networkChart').getContext('2d');
    
    // 找出最大的网络速率值
    const maxSent = Math.max(...networkSentHistory);
    const maxRecv = Math.max(...networkRecvHistory);
    const maxSpeed = Math.max(maxSent, maxRecv);
    
    // 格式化网络速率单位
    const formattedSpeed = formatNetworkSpeed(maxSpeed);
    
    // 计算Y轴最大值
    const maxY = Math.ceil(formattedSpeed.value * 1.2);
    
    // 格式化历史数据
    const formattedSentHistory = networkSentHistory.map(value => {
        if (formattedSpeed.unit === 'GB/s') {
            return value / (1024 * 1024);
        } else if (formattedSpeed.unit === 'MB/s') {
            return value / 1024;
        }
        return value;
    });
    
    const formattedRecvHistory = networkRecvHistory.map(value => {
        if (formattedSpeed.unit === 'GB/s') {
            return value / (1024 * 1024);
        } else if (formattedSpeed.unit === 'MB/s') {
            return value / 1024;
        }
        return value;
    });
    
    if (window.networkChart && typeof window.networkChart.destroy === 'function') {
        window.networkChart.destroy();
    }
    
    window.networkChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: timeLabels,
            datasets: [{
                label: `网络发送 (${formattedSpeed.unit})`,
                data: formattedSentHistory,
                borderColor: 'rgba(255, 159, 64, 1)',
                backgroundColor: 'rgba(255, 159, 64, 0.2)',
                tension: 0.4,
                fill: true
            }, {
                label: `网络接收 (${formattedSpeed.unit})`,
                data: formattedRecvHistory,
                borderColor: 'rgba(153, 102, 255, 1)',
                backgroundColor: 'rgba(153, 102, 255, 0.2)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    max: maxY,
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.8)',
                        callback: function(value) {
                            return Math.round(value * 10) / 10 + ' ' + formattedSpeed.unit;
                        }
                    }
                },
                x: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.8)'
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        color: 'rgba(255, 255, 255, 0.8)'
                    }
                }
            }
        }
    });
}
