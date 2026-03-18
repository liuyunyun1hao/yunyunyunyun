/**
 * 硅基流动 API 自定义轮询代理脚本（集成前端管理界面）
 * 环境要求：已安装 Node.js (无需 npm install 任何依赖)
 * 运行方式：node proxy.js
 * 访问地址：http://127.0.0.1:8080/
 */

const http = require('http');
const https = require('https');
const fs = require('fs');       // 用于文件读写（持久化和提供 index.html）
const path = require('path');   // 用于处理文件路径

// ================= 1. 配置区 =================

const LOCAL_PORT = 8080;                 // 本地监听端口
const MAX_REQUESTS_PER_KEY = 5;           // 每个 Key 连续处理的消息数（可自定义 1-20）
const DATA_FILE = './keys-data.json';      // 持久化文件（存储 Keys 和配置）

// 默认目标 API 地址（可从前端配置修改）
const DEFAULT_TARGET_API = 'https://api.siliconflow.cn';

// ================= 2. 内存状态 =================

let apiKeys = [];               // 存储所有 Key 对象：{ name, key, status, balance, isPolling }
let sysConfig = {
    unifiedKey: '',
    targetApi: DEFAULT_TARGET_API
};

// 轮询状态变量
let lastUsedKey = null;          // 上一次使用的 key 字符串
let currentRequestCount = 0;     // 当前 key 已使用的请求次数

// ================= 3. 持久化 =================

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
        const data = { apiKeys, sysConfig };
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('保存数据失败', err);
    }
}

// 初始加载
loadData();

// ================= 4. 轮询逻辑（动态过滤可用 Key） =================

function getNextKey() {
    // 过滤出有效且参与轮询的 Key
    const availableKeys = apiKeys.filter(k => k.status === 'valid' && k.isPolling === true);
    if (availableKeys.length === 0) {
        console.error('❌ 没有可用的 Key 参与轮询');
        return null;
    }

    let selectedKey;
    // 如果上次使用的 key 仍然在可用列表中
    if (lastUsedKey) {
        const index = availableKeys.findIndex(k => k.key === lastUsedKey);
        if (index !== -1) {
            // 继续使用同一个 key，计数增加
            currentRequestCount++;
            selectedKey = availableKeys[index];
            console.log(`[请求到达] 继续使用 Key: ${maskKey(selectedKey.key)} | 当前进度: ${currentRequestCount}/${MAX_REQUESTS_PER_KEY}`);

            // 达到阈值，切换到下一个
            if (currentRequestCount >= MAX_REQUESTS_PER_KEY) {
                const nextIndex = (index + 1) % availableKeys.length;
                lastUsedKey = availableKeys[nextIndex].key;
                currentRequestCount = 0;
                console.log(`🔄 达到阈值，切换到下一个 Key: ${maskKey(lastUsedKey)}`);
            }
        } else {
            // 上次使用的 key 已不可用，从头开始
            lastUsedKey = availableKeys[0].key;
            currentRequestCount = 1;
            selectedKey = availableKeys[0];
            console.log(`⚠️ 上次 Key 已失效，重新从第一个可用 Key 开始: ${maskKey(lastUsedKey)}`);
        }
    } else {
        // 首次使用，取第一个
        lastUsedKey = availableKeys[0].key;
        currentRequestCount = 1;
        selectedKey = availableKeys[0];
        console.log(`🆕 首次使用 Key: ${maskKey(lastUsedKey)}`);
    }

    return selectedKey ? selectedKey.key : null;
}

// 辅助函数：隐藏 Key 中间部分（仅用于日志）
function maskKey(key) {
    if (!key) return '';
    if (key.length <= 10) return key;
    return key.substring(0, 6) + '****' + key.substring(key.length - 4);
}

// ================= 5. 管理 API 处理 =================

async function handleManageAPI(req, res, body) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    // 设置 CORS 头（所有响应都加上）
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
            const newKeys = JSON.parse(body);
            apiKeys = newKeys;
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
            // 去除 targetApi 末尾斜杠
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

            // 调用硅基流动余额接口（需根据官方文档调整）
            const balance = await checkBalance(key);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                code: 20000,
                status: true,
                data: { totalBalance: balance }
            }));
        } catch (err) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 50000, status: false, message: err.message }));
        }
        return;
    }

    // 如果不是管理 API，返回 null 表示继续处理为代理请求
    return null;
}

// 调用硅基流动余额接口（示例，可能需要根据实际响应调整）
function checkBalance(apiKey) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.siliconflow.cn',
            path: '/v1/user/balance', // 请根据官方文档确认正确路径
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        };
        const req = https.get(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    // 假设返回格式：{ balance: 123.45 } 或 { data: { totalBalance: 123.45 } }
                    const balance = json.balance || json.data?.totalBalance || 0;
                    resolve(parseFloat(balance).toFixed(4));
                } catch (e) {
                    reject(new Error('解析余额失败'));
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

// ================= 6. 代理请求处理 =================

function handleProxy(req, res) {
    // 获取当前可用的 API Key
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

    // 删除可能干扰的头部
    delete options.headers['accept-encoding'];
    delete options.headers['content-length'];

    // 收集客户端请求体
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
        const requestBody = Buffer.concat(body);
        if (requestBody.length > 0) {
            options.headers['content-length'] = Buffer.byteLength(requestBody);
        }

        const proxyReq = https.request(options, (proxyRes) => {
            // 转发响应头
            const headers = { ...proxyRes.headers };
            // 添加 CORS 头（确保前端能收到响应）
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

        if (requestBody.length > 0) {
            proxyReq.write(requestBody);
        }
        proxyReq.end();
    });
}

// ================= 7. 创建 HTTP 服务器 =================

const server = http.createServer((req, res) => {
    // 统一设置 CORS 头（对所有响应都有效）
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // 处理预检请求
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        return res.end();
    }

    // 新增：处理根路径，返回前端管理界面（index.html）
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
        return; // 直接返回，不再继续处理
    }

    // 收集请求体（用于管理 API 或代理转发）
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', async () => {
        const fullBody = Buffer.concat(body).toString();

        // 先尝试作为管理 API 处理
        const handled = await handleManageAPI(req, res, fullBody);
        if (handled !== null) {
            return; // 已处理
        }

        // 否则作为代理请求处理
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