const Api = {
    baseUrl: '',
    cookie: '',

    setBaseUrl(url) {
        this.baseUrl = url.replace(/\/$/, '');
        localStorage.setItem('serverUrl', this.baseUrl);
    },

    getBaseUrl() {
        return this.baseUrl || localStorage.getItem('serverUrl') || window.location.origin;
    },

    getCookie() {
        return this.cookie || localStorage.getItem('cookie') || '';
    },

    setCookie(cookie) {
        this.cookie = cookie;
        localStorage.setItem('cookie', cookie);
    },

    getUrl(path) {
        const baseUrl = this.getBaseUrl();
        if (path.startsWith('http')) {
            return path;
        }
        const cleanPath = path.startsWith('/') ? path : '/' + path;
        return baseUrl + cleanPath;
    },

    async request(path, options = {}) {
        const url = this.getUrl(path);
        const defaultOptions = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include'
        };

        const mergedOptions = { ...defaultOptions, ...options };

        if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
            mergedOptions.body = JSON.stringify(options.body);
        }

        try {
            const response = await fetch(url, mergedOptions);
            const data = await response.json();
            
            // 保存 cookie 如果返回 -100
            if (data.code === -100 && data.cookie) {
                this.setCookie(data.cookie);
            }
            
            return data;
        } catch (error) {
            return {
                code: -1,
                msg: error.message || '网络请求失败'
            };
        }
    },

    md5(text) {
        function rotateLeft(lValue, iShiftBits) {
            return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits));
        }

        function addUnsigned(lX, lY) {
            let lX4, lY4, lX8, lY8, lResult;
            lX8 = (lX & 0x80000000);
            lY8 = (lY & 0x80000000);
            lX4 = (lX & 0x40000000);
            lY4 = (lY & 0x40000000);
            lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF);
            if (lX4 & lY4) return (lResult ^ 0x80000000 ^ lX8 ^ lY8);
            if (lX4 | lY4) {
                if (lResult & 0x40000000) return (lResult ^ 0xC0000000 ^ lX8 ^ lY8);
                else return (lResult ^ 0x40000000 ^ lX8 ^ lY8);
            } else {
                return (lResult ^ lX8 ^ lY8);
            }
        }

        function f(x, y, z) { return (x & y) | ((~x) & z); }
        function g(x, y, z) { return (x & z) | (y & (~z)); }
        function h(x, y, z) { return (x ^ y ^ z); }
        function i(x, y, z) { return (y ^ (x | (~z))); }

        function ff(a, b, c, d, x, s, ac) {
            a = addUnsigned(a, addUnsigned(addUnsigned(f(b, c, d), x), ac));
            return addUnsigned(rotateLeft(a, s), b);
        }

        function gg(a, b, c, d, x, s, ac) {
            a = addUnsigned(a, addUnsigned(addUnsigned(g(b, c, d), x), ac));
            return addUnsigned(rotateLeft(a, s), b);
        }

        function hh(a, b, c, d, x, s, ac) {
            a = addUnsigned(a, addUnsigned(addUnsigned(h(b, c, d), x), ac));
            return addUnsigned(rotateLeft(a, s), b);
        }

        function ii(a, b, c, d, x, s, ac) {
            a = addUnsigned(a, addUnsigned(addUnsigned(i(b, c, d), x), ac));
            return addUnsigned(rotateLeft(a, s), b);
        }

        function convertToWordArray(string) {
            let lWordCount;
            let lMessageLength = string.length;
            let lNumberOfWordsTemp1 = lMessageLength + 8;
            let lNumberOfWordsTemp2 = (lNumberOfWordsTemp1 - (lNumberOfWordsTemp1 % 64)) / 64;
            let lNumberOfWords = (lNumberOfWordsTemp2 + 1) * 16;
            let lWordArray = new Array(lNumberOfWords - 1);
            let lBytePosition = 0;
            let lByteCount = 0;
            while (lByteCount < lMessageLength) {
                lWordCount = (lByteCount - (lByteCount % 4)) / 4;
                lBytePosition = (lByteCount % 4) * 8;
                lWordArray[lWordCount] = (lWordArray[lWordCount] | (string.charCodeAt(lByteCount) << lBytePosition));
                lByteCount++;
            }
            lWordCount = (lByteCount - (lByteCount % 4)) / 4;
            lBytePosition = (lByteCount % 4) * 8;
            lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition);
            lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
            lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
            return lWordArray;
        }

        function wordToHex(lValue) {
            let wordToHexValue = '',
                wordToHexValueTemp = '',
                lByte, lCount;
            for (lCount = 0; lCount <= 3; lCount++) {
                lByte = (lValue >>> (lCount * 8)) & 255;
                wordToHexValueTemp = '0' + lByte.toString(16);
                wordToHexValue = wordToHexValue + wordToHexValueTemp.substr(wordToHexValueTemp.length - 2, 2);
            }
            return wordToHexValue;
        }

        let x = convertToWordArray(text);
        let a = 0x67452301, b = 0xEFCDAB89, c = 0x98BADCFE, d = 0x10325476;
        let k, AA, BB, CC, DD;

        for (k = 0; k < x.length; k += 16) {
            AA = a; BB = b; CC = c; DD = d;
            a = ff(a, b, c, d, x[k + 0], 7, 0xD76AA478);
            d = ff(d, a, b, c, x[k + 1], 12, 0xE8C7B756);
            c = ff(c, d, a, b, x[k + 2], 17, 0x242070DB);
            b = ff(b, c, d, a, x[k + 3], 22, 0xC1BDCEEE);
            a = ff(a, b, c, d, x[k + 4], 7, 0xF57C0FAF);
            d = ff(d, a, b, c, x[k + 5], 12, 0x4787C62A);
            c = ff(c, d, a, b, x[k + 6], 17, 0xA8304613);
            b = ff(b, c, d, a, x[k + 7], 22, 0xFD469501);
            a = ff(a, b, c, d, x[k + 8], 7, 0x698098D8);
            d = ff(d, a, b, c, x[k + 9], 12, 0x8B44F7AF);
            c = ff(c, d, a, b, x[k + 10], 17, 0xFFFF5BB1);
            b = ff(b, c, d, a, x[k + 11], 22, 0x895CD7BE);
            a = ff(a, b, c, d, x[k + 12], 7, 0x6B901122);
            d = ff(d, a, b, c, x[k + 13], 12, 0xFD987193);
            c = ff(c, d, a, b, x[k + 14], 17, 0xA679438E);
            b = ff(b, c, d, a, x[k + 15], 22, 0x49B40821);
            a = gg(a, b, c, d, x[k + 1], 5, 0xF61E2562);
            d = gg(d, a, b, c, x[k + 6], 9, 0xC040B340);
            c = gg(c, d, a, b, x[k + 11], 14, 0x265E5A51);
            b = gg(b, c, d, a, x[k + 0], 20, 0xE9B6C7AA);
            a = gg(a, b, c, d, x[k + 5], 5, 0xD62F105D);
            d = gg(d, a, b, c, x[k + 10], 9, 0x2441453);
            c = gg(c, d, a, b, x[k + 15], 14, 0xD8A1E681);
            b = gg(b, c, d, a, x[k + 4], 20, 0xE7D3FBC8);
            a = gg(a, b, c, d, x[k + 9], 5, 0x21E1CDE6);
            d = gg(d, a, b, c, x[k + 14], 9, 0xC33707D6);
            c = gg(c, d, a, b, x[k + 3], 14, 0xF4D50D87);
            b = gg(b, c, d, a, x[k + 8], 20, 0x455A14ED);
            a = gg(a, b, c, d, x[k + 13], 5, 0xA9E3E905);
            d = gg(d, a, b, c, x[k + 2], 9, 0xFCEFA3F8);
            c = gg(c, d, a, b, x[k + 7], 14, 0x676F02D9);
            b = gg(b, c, d, a, x[k + 12], 20, 0x8D2A4C8A);
            a = hh(a, b, c, d, x[k + 5], 4, 0xFFFA3942);
            d = hh(d, a, b, c, x[k + 8], 11, 0x8771F681);
            c = hh(c, d, a, b, x[k + 11], 16, 0x6D9D6122);
            b = hh(b, c, d, a, x[k + 14], 23, 0xFDE5380C);
            a = hh(a, b, c, d, x[k + 1], 4, 0xA4BEEA44);
            d = hh(d, a, b, c, x[k + 4], 11, 0x4BDECFA9);
            c = hh(c, d, a, b, x[k + 7], 16, 0xF6BB4B60);
            b = hh(b, c, d, a, x[k + 10], 23, 0xBEBFBC70);
            a = hh(a, b, c, d, x[k + 13], 4, 0x289B7EC6);
            d = hh(d, a, b, c, x[k + 0], 11, 0xEAA127FA);
            c = hh(c, d, a, b, x[k + 3], 16, 0xD4EF3085);
            b = hh(b, c, d, a, x[k + 6], 23, 0x4881D05);
            a = hh(a, b, c, d, x[k + 9], 4, 0xD9D4D039);
            d = hh(d, a, b, c, x[k + 12], 11, 0xE6DB99E5);
            c = hh(c, d, a, b, x[k + 15], 16, 0x1FA27CF8);
            b = hh(b, c, d, a, x[k + 2], 23, 0xC4AC5665);
            a = ii(a, b, c, d, x[k + 0], 6, 0xF4292244);
            d = ii(d, a, b, c, x[k + 7], 10, 0x432AFF97);
            c = ii(c, d, a, b, x[k + 14], 15, 0xAB9423A7);
            b = ii(b, c, d, a, x[k + 5], 21, 0xFC93A039);
            a = ii(a, b, c, d, x[k + 12], 6, 0x655B59C3);
            d = ii(d, a, b, c, x[k + 3], 10, 0x8F0CCC92);
            c = ii(c, d, a, b, x[k + 10], 15, 0xFFEFF47D);
            b = ii(b, c, d, a, x[k + 1], 21, 0x85845DD1);
            a = ii(a, b, c, d, x[k + 8], 6, 0x6FA87E4F);
            d = ii(d, a, b, c, x[k + 15], 10, 0xFE2CE6E0);
            c = ii(c, d, a, b, x[k + 6], 15, 0xA3014314);
            b = ii(b, c, d, a, x[k + 13], 21, 0x4E0811A1);
            a = ii(a, b, c, d, x[k + 4], 6, 0xF7537E82);
            d = ii(d, a, b, c, x[k + 11], 10, 0xBD3AF235);
            c = ii(c, d, a, b, x[k + 2], 15, 0x2AD7D2BB);
            b = ii(b, c, d, a, x[k + 9], 21, 0xEB86D391);
            a = addUnsigned(a, AA);
            b = addUnsigned(b, BB);
            c = addUnsigned(c, CC);
            d = addUnsigned(d, DD);
        }

        return (wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d)).toLowerCase();
    },

    async login(secret, serverUrl) {
        this.setBaseUrl(serverUrl);

        // 1. 检查是否有已保存的 cookie
        let cookie = this.getCookie();

        // 2. 如果没有 cookie，调用 getApiList 获取
        if (!cookie) {
            const url1 = this.getUrl('/index/api/getApiList');
            try {
                const response1 = await fetch(url1, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    credentials: 'include'
                });
                const data1 = await response1.json();

                if (data1.code === -100 && data1.cookie) {
                    cookie = data1.cookie;
                    this.setCookie(cookie);
                } else if (data1.code === 0) {
                    // 已经登录
                    return { success: true, msg: '已登录' };
                } else {
                    return { success: false, msg: data1.msg || '获取 cookie 失败' };
                }
            } catch (error) {
                return { success: false, msg: '网络请求失败: ' + error.message };
            }

            if (!cookie) {
                return { success: false, msg: '获取 cookie 失败' };
            }
        }

        // 3. 计算 digest
        const digestStr = `zlmediakit:${secret}:${cookie}`;
        const digest = this.md5(digestStr);

        // 4. 调用 login 接口
        const url2 = this.getUrl('/index/api/login');

        try {
            const response2 = await fetch(url2, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ digest }),
                credentials: 'include'
            });
            const data2 = await response2.json();

            if (data2.code === 0) {
                return { success: true, msg: '登录成功' };
            } else {
                return { success: false, msg: data2.msg || '登录失败' };
            }
        } catch (error) {
            return { success: false, msg: '登录请求失败: ' + error.message };
        }
    },

    async getApiList() {
        return this.request('/index/api/getApiList');
    },

    async getMediaList(schema) {
        const body = schema ? { schema } : {};
        return this.request('/index/api/getMediaList', { body });
    },

    async getMediaInfo(schema, vhost, app, stream) {
        return this.request('/index/api/getMediaInfo', { body: { schema, vhost, app, stream } });
    },

    async getStatistic() {
        return this.request('/index/api/getStatistic');
    },

    async getThreadsLoad() {
        return this.request('/index/api/getThreadsLoad');
    },

    async getWorkThreadsLoad() {
        return this.request('/index/api/getWorkThreadsLoad');
    },

    async getVersion() {
        return this.request('/index/api/version');
    },

    async getServerConfig() {
        return this.request('/index/api/getServerConfig');
    },

    async setServerConfig(config) {
        const params = new URLSearchParams();
        Object.keys(config).forEach(key => {
            params.append(key, config[key]);
        });
        return this.request(`/index/api/setServerConfig?${params.toString()}`);
    },

    async logout() {
        const result = await this.request('/index/api/logout');
        return result;
    },

    async getHostStats() {
        return this.request('/index/pyapi/host-stats', { method: 'GET' });
    },

    async closeStream(schema, vhost, app, stream) {
        return this.request('/index/api/close_stream', { body: { schema, vhost, app, stream, force: 1 } });
    },

    async getMediaPlayerList(schema, vhost, app, stream) {
        return this.request('/index/api/getMediaPlayerList', { body: { schema, vhost, app, stream } });
    },

    async getNetworkList() {
        return this.request('/index/api/getAllSession');
    },

    clearAuth() {
        this.cookie = '';
        localStorage.removeItem('serverUrl');
        localStorage.removeItem('cookie');
    }
};

function showToast(message, type = 'info', duration = 3000) {
    const toast = document.getElementById('toast');
    if (!toast) return;

    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
    }, duration);
}

async function checkAuth() {
    const currentPath = window.location.pathname;
    const isLoginPage = currentPath.includes('login.html');

    const serverUrl = localStorage.getItem('serverUrl');
    const cookie = localStorage.getItem('cookie');
    
    if (!serverUrl) {
        if (!isLoginPage) {
            window.location.href = 'login.html';
        }
        return false;
    }

    // 加载已保存的服务器地址和 cookie
    Api.setBaseUrl(serverUrl);
    if (cookie) {
        Api.setCookie(cookie);
    }

    // 检查是否已登录
    try {
        const result = await Api.getApiList();
        if (result.code === 0) {
            return true;
        } else if (result.code === -100) {
            if (!isLoginPage) {
                window.location.href = 'login.html';
            }
            return false;
        }
        return false;
    } catch (error) {
        if (!isLoginPage) {
            window.location.href = 'login.html';
        }
        return false;
    }
}
