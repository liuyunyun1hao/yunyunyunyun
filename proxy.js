const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());

// ================= 文件路径 =================
const PORT = 3000;
const KEYS_FILE = path.join(__dirname, 'keys.json'); 
const CONFIG_FILE = path.join(__dirname, 'config.json'); 
// ==========================================

function getConfig() {
    let conf = { unifiedKey: "sk-my-super-local-key", targetApi: "https://api.siliconflow.cn", pollingLimit: 1 };
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            if (parsed.unifiedKey) conf.unifiedKey = parsed.unifiedKey.trim();
            if (parsed.targetApi) conf.targetApi = parsed.targetApi.trim();
            if (parsed.pollingLimit) conf.pollingLimit = parsed.pollingLimit;
        } catch (e) {}
    }
    if (conf.targetApi.includes('127.0.0.1') || conf.targetApi.includes('localhost') || conf.targetApi.includes('0.0.0.0')) {
        conf.targetApi = "https://api.siliconflow.cn";
    }
    return conf;
}

// 【自动防呆】无论软件漏没漏写 /v1，全部智能补全
app.use((req, res, next) => {
    const apiPaths = ['/chat/completions', '/models', '/embeddings', '/images/generations'];
    if (apiPaths.some(p => req.url === p || req.url.startsWith(p + '/'))) {
        req.url = '/v1' + req.url;
    }
    next();
});

app.use(express.static(__dirname));

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

// 确保拉取模型通道 100% 顺畅
app.get(['/v1/models', '/models'], async (req, res) => {
    let keys = [];
    if (fs.existsSync(KEYS_FILE)) keys = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
    
    const validKeys = keys.filter(k => k.status === 'valid');
    if (validKeys.length === 0) return res.status(500).json({ error: "没有有效 API Key" });
    
    const keyToUse = validKeys[0].key; 
    let targetBase = getConfig().targetApi.replace(/\/+$/, '');
    if (targetBase.endsWith('/v1')) targetBase = targetBase.slice(0, -3); 
    
    try {
        const response = await fetch(`${targetBase}/v1/models`, {
            headers: { 'Authorization': `Bearer ${keyToUse}`, 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (err) {
        res.status(500).json({ error: "获取模型列表失败" });
    }
});

// 【核心突破】极度宽容的强行接管机制
app.use('/v1', (req, res, next) => {
    if (req.method === 'OPTIONS') return next();

    let keys = [];
    if (fs.existsSync(KEYS_FILE)) keys = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
    const currentConfig = getConfig();
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '').trim();

    // 只要聊天软件里填的不是真正的 sk- 密钥（填错、留空、填 pwd），网关全部强行拦截并接管！
    if (token === currentConfig.unifiedKey || token === '' || !token.startsWith('sk-')) {
        const info = getNextKeyInfo(keys, currentConfig.pollingLimit);
        if (!info || !info.keyObj) {
            return res.status(401).json({ error: { message: "【网关提示】密钥池为空或全失效，请进入管理面板处理。" } });
        }
        req.proxyKey = info.keyObj.key;
        req.proxyLog = `[轮询进度 ${info.currentUsage}/${info.limit}次] -> [${info.keyObj.name || '未命名'}]`;
    } else {
        // 除非用户显式使用了一个真正的 sk- 密钥，才放行直连
        req.proxyKey = token;
        req.proxyLog = `[直连指定] ->`;
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
    onProxyReq: (proxyReq, req, res) => {
        if (req.proxyKey) {
            proxyReq.setHeader('Authorization', `Bearer ${req.proxyKey}`);
            console.log(`${req.proxyLog} ${req.proxyKey.substring(0, 8)}***`);
        }
    },
    onError: (err, req, res) => res.status(504).json({ error: { message: `本地代理转发失败: ${err.message}` } })
});

app.use('/v1', apiProxy);
app.use(express.json({ limit: '5mb' }));

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
            headers: { 'Authorization': `Bearer ${key}` }
        });
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    const conf = getConfig();
    console.log(`\n🚀 全栈网关已完美升级!\n==================================================\n🌐 管理面板 : http://127.0.0.1:${PORT}\n🔌 API 接口 : http://127.0.0.1:${PORT}/v1\n🔑 统一 Key : 随意填，全自动强行轮询！\n==================================================\n`);
});
