/**
 * 硅基流动 API 自定义轮询代理脚本（集成前端管理界面）
 * 环境要求：已安装 Node.js (无需 npm install 任何依赖)
 * 运行方式：node proxy.js
 * 访问地址：http://127.0.0.1:8080/
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ================= 配置区 =================
const LOCAL_PORT = 8080;
const MAX_REQUESTS_PER_KEY = 5;        // 每个 Key 连续处理的消息数
const DATA_FILE = './keys-data.json';
const DEFAULT_TARGET_API = 'https://api.siliconflow.cn';

// ================= 内存状态 =================
let apiKeys = [];               // { name, key, status, balance, isPolling }
let sysConfig = {
    unifiedKey: '',
    targetApi: DEFAULT_TARGET_API
};

// 轮询状态变量
let lastUsedKey = null;
let currentRequestCount = 0;

// ================= 持久化 =================
function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            apiKeys = data.apiKeys || [];
            sysConfig = data.sysConfig || { unifiedKey: '', targetApi: DEFAULT_TARGET_API };
            console.log('📦 已从文件加载数据');
        }
    } catch (err) {
        console.error('加载数据失败，将使用默认配置', err);
    }
}
function saveData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify({ apiKeys, sysConfig }, null, 2));
    } catch (err) {
        console.error('保存数据失败', err);
    }
}
loadData();

// ================= 轮询逻辑 =================
function getNextKey() {
    const availableKeys = apiKeys.filter(k => k.status === 'valid' && k.isPolling === true);
    if (availableKeys.length === 0) {
        console.error('❌ 没有可用的 Key 参与轮询');
        return null;
    }

    let selectedKey;
    if (lastUsedKey) {
        const index = availableKeys.findIndex(k => k.key === lastUsedKey);
        if (index !== -1) {
            currentRequestCount++;
            selectedKey = availableKeys[index];
            console.log(`[请求到达] 继续使用 Key: ${maskKey(selectedKey.key)} | 进度: ${currentRequestCount}/${MAX_REQUESTS_PER_KEY}`);

            if (currentRequestCount >= MAX_REQUESTS_PER_KEY) {
                const nextIndex = (index + 1) % availableKeys.length;
                lastUsedKey = availableKeys[nextIndex].key;
                currentRequestCount = 0;
                console.log(`🔄 达到阈值，切换到下一个 Key: ${maskKey(lastUsedKey)}`);
            }
        } else {
            lastUsedKey = availableKeys[0].key;
            currentRequestCount = 1;
            selectedKey = availableKeys[0];
            console.log(`⚠️ 上次 Key 已失效，重新从第一个可用 Key 开始: ${maskKey(lastUsedKey)}`);
        }
    } else {
        lastUsedKey = availableKeys[0].key;
        currentRequestCount = 1;
        selectedKey = availableKeys[0];
        console.log(`🆕 首次使用 Key: ${maskKey(lastUsedKey)}`);
    }
    return selectedKey ? selectedKey.key : null;
}

function maskKey(key) {
    if (!key) return '';
    if (key.length <= 10) return key;
    return key.substring(0, 6) + '****' + key.substring(key.length - 4);
}

// ================= 余额查询（增强版） =================
function checkBalance(apiKey) {
    return new Promise((resolve, reject) => {
        // 尝试多个可能的余额接口路径
        const paths = ['/v1/user/balance', '/v1/users/balance', '/v1/dashboard/balance'];
        let attempts = 0;

        const tryPath = (index) => {
            if (index >= paths.length) {
                reject(new Error('所有余额接口尝试均失败，请检查网络或Key有效性'));
                return;
            }
            const path = paths[index];
            const options = {
                hostname: 'api.siliconflow.cn',
                path: path,
                method: 'GET',
                headers: { 'Authorization': `Bearer ${apiKey}` },
                timeout: 10000 // 10秒超时
            };

            console.log(`尝试查询余额：${path}`);
            const req = https.get(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode !== 200) {
                        console.log(`   ${path} 返回 HTTP ${res.statusCode}，响应体: ${data.substring(0,200)}`);
                        tryPath(index + 1);
                        return;
                    }
                    try {
                        const json = JSON.parse(data);
                        // 兼容多种字段格式
                        const balance = json.balance 
                                    || json.data?.balance 
                                    || json.totalBalance 
                                    || json.data?.totalBalance 
                                    || 0;
                        console.log(`✅ 余额查询成功：${balance}`);
                        resolve(parseFloat(balance).toFixed(4));
                    } catch (e) {
                        console.log(`   解析响应失败: ${e.message}，原始数据: ${data.substring(0,200)}`);
                        tryPath(index + 1);
                    }
                });
            });

            req.on('error', (err) => {
                console.log(`   ${path} 请求错误: ${err.message}`);
                tryPath(index + 1);
            });

            req.on('timeout', () => {
                req.destroy();
                console.log(`   ${path} 超时`);
                tryPath(index + 1);
            });

            req.end();
        };

        tryPath(0);
    });
}

// ================= 管理 API 处理 =================
async function handleManageAPI(req, res, body) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    // 统一 CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        return res.end();
    }

    // GET /api/keys
    if (path === '/api/keys' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(apiKeys));
    }

    // POST /api/keys
    if (path === '/api/keys' && req.method === 'POST') {
        try {
            apiKeys = JSON.parse(body);
            saveData();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
        return;
    }

    // GET /api/config
    if (path === '/api/config' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(sysConfig));
    }

    // POST /api/config
    if (path === '/api/config' && req.method === 'POST') {
        try {
            const newConfig = JSON.parse(body);
            if (newConfig.targetApi) newConfig.targetApi = newConfig.targetApi.replace(/\/$/, '');
            sysConfig = newConfig;
            saveData();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
        return;
    }

    // POST /api/check_balance
    if (path === '/api/check_balance' && req.method === 'POST') {
        try {
            const { key } = JSON.parse(body);
            if (!key) throw new Error('Missing key');

            const balance = await checkBalance(key);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                code: 20000,
                status: true,
                data: { totalBalance: balance }
            }));
        } catch (err) {
            console.error('余额查询失败:', err.message);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                code: 50000,
                status: false,
                message: err.message
            }));
        }
        return;
    }

    return null; // 不是管理 API
}

// ================= 代理请求处理 =================
function handleProxy(req, res) {
    const apiKey = getNextKey();
    if (!apiKey) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'No available API keys' }));
    }

    const targetBase = sysConfig.targetApi || DEFAULT_TARGET_API;
    const targetUrl = new URL(targetBase + req.url);

    const options = {
        hostname: targetUrl.hostname,
        port: targetUrl.port || 443,
        path: targetUrl.pathname + targetUrl.search,
        method: req.method,
        headers: {
            ...req.headers,
            'host': targetUrl.hostname,
            'authorization': `Bearer ${apiKey}`
        }
    };

    delete options.headers['accept-encoding'];
    delete options.headers['content-length'];

    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
        const requestBody = Buffer.concat(body);
        if (requestBody.length > 0) {
            options.headers['content-length'] = Buffer.byteLength(requestBody);
        }

        const proxyReq = https.request(options, (proxyRes) => {
            const headers = { ...proxyRes.headers };
            headers['Access-Control-Allow-Origin'] = '*';
            res.writeHead(proxyRes.statusCode, headers);
            proxyRes.pipe(res, { end: true });
        });

        proxyReq.on('error', (err) => {
            console.error(`❌ 代理请求失败: ${err.message}`);
            if (!res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Bad Gateway', details: err.message }));
            }
        });

        if (requestBody.length > 0) proxyReq.write(requestBody);
        proxyReq.end();
    });
}

// ================= 创建 HTTP 服务器 =================
const server = http.createServer((req, res) => {
    // 统一 CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        return res.end();
    }

    // 提供前端页面
    if (req.method === 'GET' && req.url === '/') {
        const filePath = path.join(__dirname, 'index.html');
        fs.readFile(filePath, (err, data) => {
            if (err) {
                console.error('无法读取 index.html:', err);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal Server Error - index.html not found');
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(data);
            }
        });
        return;
    }

    // 收集请求体
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', async () => {
        const fullBody = Buffer.concat(body).toString();

        // 先尝试作为管理 API 处理
        const handled = await handleManageAPI(req, res, fullBody);
        if (handled !== null) return;

        // 否则作为代理请求
        handleProxy(req, res);
    });
});

server.listen(LOCAL_PORT, () => {
    console.log(`\n======================================================`);
    console.log(`✅ 增强版代理服务已启动（带前端界面）`);
    console.log(`🚀 监听端口: ${LOCAL_PORT}`);
    console.log(`🌐 访问前端管理页面: http://127.0.0.1:${LOCAL_PORT}/`);
    console.log(`🔑 当前可用 Key 数量: ${apiKeys.filter(k => k.status === 'valid' && k.isPolling).length}`);
    console.log(`⚙️  每个 Key 连续处理 ${MAX_REQUESTS_PER_KEY} 条消息后切换`);
    console.log(`📁 数据持久化文件: ${DATA_FILE}`);
    console.log(`======================================================\n`);
});