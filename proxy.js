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
const DATA_FILE = './keys-data.json';
const DEFAULT_TARGET_API = 'https://api.siliconflow.cn';

// ================= 内存状态 =================
let apiKeys = [];               // { name, key, status, balance, isPolling }
let sysConfig = {
    unifiedKey: '',
    targetApi: DEFAULT_TARGET_API,
    maxRequestsPerKey: 5        // 默认单个 Key 连续处理 5 条消息
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
            sysConfig = { ...sysConfig, ...(data.sysConfig || {}) };
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

// ================= 轮询逻辑（动态过滤可用 Key） =================
function getNextKey() {
    const availableKeys = apiKeys.filter(k => k.status === 'valid' && k.isPolling === true);
    if (availableKeys.length === 0) {
        console.error('❌ 没有可用的 Key 参与轮询');
        return null;
    }

    const maxReqs = sysConfig.maxRequestsPerKey || 5;
    let selectedKey;

    if (lastUsedKey) {
        const index = availableKeys.findIndex(k => k.key === lastUsedKey);
        if (index !== -1) {
            currentRequestCount++;
            selectedKey = availableKeys[index];
            console.log(`[请求到达] 正在使用 Key: ${maskKey(selectedKey.key)} | 进度: ${currentRequestCount}/${maxReqs}`);

            if (currentRequestCount >= maxReqs) {
                const nextIndex = (index + 1) % availableKeys.length;
                lastUsedKey = availableKeys[nextIndex].key;
                currentRequestCount = 0;
                console.log(`🔄 达到设定阈值(${maxReqs}次)，下一次将切换到 Key: ${maskKey(lastUsedKey)}`);
            }
        } else {
            lastUsedKey = availableKeys[0].key;
            currentRequestCount = 1;
            selectedKey = availableKeys[0];
            console.log(`⚠️ 上次 Key 已失效或被关闭，重新从首个可用 Key 开始: ${maskKey(lastUsedKey)}`);
        }
    } else {
        lastUsedKey = availableKeys[0].key;
        currentRequestCount = 1;
        selectedKey = availableKeys[0];
        console.log(`🆕 首次分配 Key: ${maskKey(lastUsedKey)}`);
    }
    return selectedKey ? selectedKey.key : null;
}

function maskKey(key) {
    if (!key) return '';
    if (key.length <= 10) return key;
    return key.substring(0, 6) + '****' + key.substring(key.length - 4);
}

// ================= 修复版：余额与测活查询 =================
function checkBalance(apiKey) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.siliconflow.cn',
            path: '/v1/user/info',                     // 🐛 修复：增加了官方要求的 /v1 路径
            method: 'GET',
            headers: { 'Authorization': `Bearer ${apiKey}` }
        };
        const req = https.get(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                    return;
                }
                try {
                    const json = JSON.parse(data);
                    if (json.code === 20000 && json.data && typeof json.data.totalBalance !== 'undefined') {
                        const balance = json.data.totalBalance;
                        resolve(parseFloat(balance).toFixed(4));
                    } else {
                        reject(new Error('无法解析余额字段，请检查接口返回格式'));
                    }
                } catch (e) {
                    reject(new Error('解析响应失败：' + e.message));
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

// ================= 管理 API 处理 =================
async function handleManageAPI(req, res, body) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        return res.end();
    }

    if (path === '/api/keys' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(apiKeys));
    }

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
        return true;
    }

    if (path === '/api/config' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(sysConfig));
    }

    if (path === '/api/config' && req.method === 'POST') {
        try {
            const newConfig = JSON.parse(body);
            if (newConfig.targetApi) newConfig.targetApi = newConfig.targetApi.replace(/\/$/, '');
            sysConfig = { ...sysConfig, ...newConfig };
            saveData();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
        return true;
    }

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
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                code: 50000,
                status: false,
                message: err.message
            }));
        }
        return true;
    }

    return false; // 不是管理 API，继续往下走代理逻辑
}

// ================= 修复版：代理请求处理 =================
function handleProxy(req, res, rawBodyBuffer) {
    const apiKey = getNextKey();
    if (!apiKey) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'No available API keys in polling pool' }));
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
            'authorization': `Bearer ${apiKey}` // 自动替换为池子里的真实 Key
        }
    };

    delete options.headers['accept-encoding'];
    delete options.headers['content-length'];

    if (rawBodyBuffer && rawBodyBuffer.length > 0) {
        options.headers['content-length'] = Buffer.byteLength(rawBodyBuffer);
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

    // 🐛 修复：直接将主进程收集到的请求体 Buffer 写入代理请求，解决阻塞问题
    if (rawBodyBuffer && rawBodyBuffer.length > 0) {
        proxyReq.write(rawBodyBuffer);
    }
    proxyReq.end();
}

// ================= 创建 HTTP 服务器 =================
const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        return res.end();
    }

    if (req.method === 'GET' && req.url === '/') {
        const filePath = path.join(__dirname, 'index.html');
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal Server Error - index.html not found');
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(data);
            }
        });
        return;
    }

    // 收集完整的请求体 Buffer
    let bodyChunks = [];
    req.on('data', chunk => bodyChunks.push(chunk));
    req.on('end', async () => {
        const rawBodyBuffer = Buffer.concat(bodyChunks);
        const fullBodyString = rawBodyBuffer.toString('utf8');

        // 先判断是否是管理面板的请求
        const isManaged = await handleManageAPI(req, res, fullBodyString);
        
        // 如果不是管理面板请求，则透传 Buffer 给代理函数
        if (!isManaged) {
            handleProxy(req, res, rawBodyBuffer);
        }
    });
});

server.listen(LOCAL_PORT, () => {
    console.log(`\n======================================================`);
    console.log(`✅ 硅基流动增强版代理服务已启动（带前端界面）`);
    console.log(`🚀 监听端口: ${LOCAL_PORT}`);
    console.log(`🌐 访问前端管理页面: http://127.0.0.1:${LOCAL_PORT}/`);
    console.log(`⚙️  当前设置每个 Key 轮询处理 ${sysConfig.maxRequestsPerKey} 次`);
    console.log(`📁 数据持久化文件: ${DATA_FILE}`);
    console.log(`======================================================\n`);
});
