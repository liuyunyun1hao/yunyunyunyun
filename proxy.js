const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());

// ================= 配置与路径 =================
const PORT = 3000;
const KEYS_FILE = path.join(__dirname, 'keys.json'); 
const CONFIG_FILE = path.join(__dirname, 'config.json'); 

function getConfig() {
    let conf = { unifiedKey: "sk-my-super-local-key", targetApi: "https://api.siliconflow.cn", pollingLimit: 1 };
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            if (parsed.unifiedKey) conf.unifiedKey = parsed.unifiedKey.trim();
            if (parsed.targetApi) conf.targetApi = parsed.targetApi.trim();
            if (parsed.pollingLimit) conf.pollingLimit = parseInt(parsed.pollingLimit) || 1;
        } catch (e) {}
    }
    // 自动修正本地死循环地址
    if (conf.targetApi.includes('127.0.0.1') || conf.targetApi.includes('localhost') || conf.targetApi.includes('0.0.0.0')) {
        conf.targetApi = "https://api.siliconflow.cn";
    }
    return conf;
}

let totalRequestCount = 0; 
function getNextKeyInfo(keys, limit) {
    const activeKeys = keys.filter(k => k.status === 'valid' && k.isPolling);
    if (activeKeys.length === 0) return null;
    const keyIndex = Math.floor(totalRequestCount / limit) % activeKeys.length;
    const keyObj = activeKeys[keyIndex];
    const currentUsage = (totalRequestCount % limit) + 1;
    totalRequestCount++;
    return { keyObj, currentUsage, limit };
}

// 1. 静态网页服务
app.use(express.static(__dirname));

// 2. 本地管理 API
app.use('/api', express.json({ limit: '5mb' }));
app.get('/api/keys', (req, res) => {
    if (fs.existsSync(KEYS_FILE)) res.json(JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8')));
    else res.json([]);
});
app.post('/api/keys', (req, res) => {
    fs.writeFileSync(KEYS_FILE, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ success: true });
});
app.get('/api/config', (req, res) => res.json(getConfig()));
app.post('/api/config', (req, res) => {
    totalRequestCount = 0; 
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ success: true });
});
app.post('/api/check_balance', async (req, res) => {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: '请提供 Key' });
    let targetBase = getConfig().targetApi.replace(/\/+$/, '');
    if (targetBase.endsWith('/v1')) targetBase = targetBase.slice(0, -3);
    try {
        const response = await fetch(`${targetBase}/v1/user/info`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. 智能路径补全拦截 (针对忘了加 /v1 的客户端)
app.use((req, res, next) => {
    const apiPaths = ['/chat/completions', '/models', '/embeddings', '/images/generations'];
    if (apiPaths.some(p => req.url.startsWith(p))) {
        req.url = '/v1' + req.url;
    }
    next();
});

// 4. 专属模型列表拉取
app.get('/v1/models', async (req, res) => {
    let keys = [];
    if (fs.existsSync(KEYS_FILE)) keys = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
    const validKeys = keys.filter(k => k.status === 'valid');
    if (validKeys.length === 0) return res.status(500).json({ error: "无可用 Key" });
    
    let targetBase = getConfig().targetApi.replace(/\/+$/, '');
    if (targetBase.endsWith('/v1')) targetBase = targetBase.slice(0, -3); 
    
    try {
        const response = await fetch(`${targetBase}/v1/models`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${validKeys[0].key}` }
        });
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (err) {
        res.status(500).json({ error: "获取模型失败" });
    }
});

// 5. OpenAI 格式核心代理网关
app.use('/v1', (req, res, next) => {
    if (req.method === 'OPTIONS') return next();

    let keys = [];
    if (fs.existsSync(KEYS_FILE)) keys = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
    const currentConfig = getConfig();
    const authHeader = req.headers.authorization;

    if (authHeader) {
        const token = authHeader.replace('Bearer ', '').trim();
        if (token === currentConfig.unifiedKey) {
            const info = getNextKeyInfo(keys, currentConfig.pollingLimit);
            if (!info || !info.keyObj) {
                return res.status(401).json({ error: { message: "【本地网关拦截】池子中没有可用或参与轮询的 API Key，请去管理面板添加并测活。", type: "invalid_request_error" } });
            }
            req.proxyKey = info.keyObj.key;
            req.proxyLog = `[轮询进度 ${info.currentUsage}/${info.limit}次] -> [${info.keyObj.name || '未命名'}]`;
        } else {
            if (!token.startsWith('sk-')) {
                return res.status(401).json({ error: { message: `【本地网关拦截】Key无效！您填写的 Key 既不是硅基流动真实 Key，也不是设定的统一 Key。当前正确的统一Key为：${currentConfig.unifiedKey}`, type: "invalid_request_error" } });
            }
            req.proxyKey = token;
            req.proxyLog = `[直连指定] ->`;
        }
    }
    next();
});

const apiProxy = createProxyMiddleware({
    target: 'https://api.siliconflow.cn', 
    router: () => {
        let url = getConfig().targetApi.replace(/\/+$/, '');
        if (url.endsWith('/v1')) url = url.slice(0, -3);
        return url;
    },
    changeOrigin: true,
    ws: true,
    pathRewrite: (path, req) => {
        // 【终极防线】修复核心！确保发往硅基流动的请求必定以 /v1 开头！
        // 之前就是因为丢了这个，导致硅基流动报 401/404
        if (!path.startsWith('/v1')) {
            return '/v1' + path;
        }
        return path;
    },
    onProxyReq: (proxyReq, req, res) => {
        if (req.proxyKey) {
            proxyReq.setHeader('Authorization', `Bearer ${req.proxyKey}`);
            console.log(`${req.proxyLog} ${req.proxyKey.substring(0, 8)}***`);
        }
    },
    onError: (err, req, res) => res.status(504).json({ error: { message: `本地代理转发超时或失败: ${err.message}`, type: "proxy_error" } })
});

app.use('/v1', apiProxy);

app.listen(PORT, '0.0.0.0', () => {
    const conf = getConfig();
    console.log(`\n🚀 全栈网关终极修复版已启动!\n==================================================\n🌐 管理面板 : http://127.0.0.1:${PORT}\n🔌 API 接口 : http://127.0.0.1:${PORT}/v1\n🔑 统一 Key : ${conf.unifiedKey}\n==================================================\n`);
});
