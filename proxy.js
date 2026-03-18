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
    
    // 【终极防御】防止用户把本地地址填成了目标 API 导致 504 循环死机
    if (conf.targetApi.includes('127.0.0.1') || conf.targetApi.includes('localhost') || conf.targetApi.includes('0.0.0.0')) {
        console.log(`\n[警告] 检测到目标地址填成了本地地址，已自动修正为官方接口！\n`);
        conf.targetApi = "https://api.siliconflow.cn";
    }
    return conf;
}

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
            method: 'GET',
            headers: { 'Authorization': `Bearer ${keyToUse}`, 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (err) {
        res.status(500).json({ error: "获取模型列表失败" });
    }
});

// 【核心修复】前置鉴权与拦截器，拦截无效请求，提供清晰的中文报错
app.use('/v1', (req, res, next) => {
    if (req.method === 'OPTIONS') return next();

    let keys = [];
    if (fs.existsSync(KEYS_FILE)) keys = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));

    const currentConfig = getConfig();
    const authHeader = req.headers.authorization;

    if (authHeader) {
        const token = authHeader.replace('Bearer ', '').trim();

        if (token === currentConfig.unifiedKey) {
            // 使用统一Key，开始找真实Key
            const info = getNextKeyInfo(keys, currentConfig.pollingLimit);
            if (!info || !info.keyObj) {
                // 如果池子里没 Key 或都失效了，直接报错打回
                return res.status(401).json({
                    error: { message: "【本地代理提示】池子中没有可用或参与轮询的 API Key，请去管理面板添加并测活。" }
                });
            }
            req.proxyKey = info.keyObj.key;
            req.proxyLog = `[轮询进度 ${info.currentUsage}/${info.limit}次] -> [${info.keyObj.name || '未命名'}]`;
        } else {
            // 用户填的不是统一Key
            if (!token.startsWith('sk-')) {
                return res.status(401).json({
                    error: { message: `【本地代理提示】您在软件里填的 Key 既不是统一Key，也不是有效的硅基流动Key。请检查是否少打或多打了空格。您当前的统一 Key 为：${currentConfig.unifiedKey}` }
                });
            }
            // 直连
            req.proxyKey = token;
            req.proxyLog = `[直连指定] ->`;
        }
    }
    next();
});

// 对话代理中间件
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
            method: 'GET',
            headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    const conf = getConfig();
    console.log(`\n🚀 全栈网关已深度修复并启动!\n==================================================\n🌐 管理面板 : http://127.0.0.1:${PORT}\n🔌 API 接口 : http://127.0.0.1:${PORT}/v1\n🔑 统一 Key : ${conf.unifiedKey}\n==================================================\n`);
});
