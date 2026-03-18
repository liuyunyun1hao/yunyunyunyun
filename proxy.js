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

// 【新增】读取全局配置（统一Key和目标API）
function getConfig() {
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        } catch (e) {}
    }
    return { unifiedKey: "sk-my-super-local-key", targetApi: "https://api.siliconflow.cn" };
}

app.use(express.static(__dirname));

let currentIndex = 0;

function getNextKeyObj(keys) {
    const activeKeys = keys.filter(k => k.status === 'valid' && k.isPolling);
    if (activeKeys.length === 0) return null;
    const keyObj = activeKeys[currentIndex % activeKeys.length];
    currentIndex++;
    return keyObj;
}

// 专属模型拉取通道
app.get(['/v1/models', '/models'], async (req, res) => {
    let keys = [];
    if (fs.existsSync(KEYS_FILE)) keys = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
    
    const validKeys = keys.filter(k => k.status === 'valid');
    if (validKeys.length === 0) return res.status(500).json({ error: "没有有效 API Key" });
    
    const keyToUse = validKeys[0].key; 
    const targetBase = getConfig().targetApi.replace(/\/$/, ''); // 获取自定义URL并去除尾部斜杠
    
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

// 对话代理中间件（动态读取目标 URL 和 统一 Key）
const apiProxy = createProxyMiddleware({
    // 动态路由，使用用户自定义的 URL
    router: () => getConfig().targetApi.replace(/\/$/, ''),
    changeOrigin: true,
    ws: true,
    onProxyReq: (proxyReq, req, res) => {
        let keys = [];
        if (fs.existsSync(KEYS_FILE)) keys = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));

        const currentConfig = getConfig();
        const authHeader = req.headers.authorization;
        let finalKey = null;

        if (authHeader) {
            const token = authHeader.replace('Bearer ', '').trim();
            // 使用用户自定义的 unifiedKey 进行比对
            if (token === currentConfig.unifiedKey) {
                const keyObj = getNextKeyObj(keys);
                if(keyObj) {
                    finalKey = keyObj.key;
                    console.log(`[轮询] -> [${keyObj.name}] ${finalKey.substring(0, 8)}***`);
                }
            } else {
                finalKey = token;
                console.log(`[直连] -> 指定 Key: ${finalKey.substring(0, 8)}***`);
            }
        }

        if (finalKey) proxyReq.setHeader('Authorization', `Bearer ${finalKey}`);
    },
    onError: (err, req, res) => res.status(500).json({ error: "本地代理转发失败" })
});

app.use('/v1', apiProxy);
app.use(express.json({ limit: '5mb' }));

// ======= 接口路由 =======
// 1. Keys 管理
app.get('/api/keys', (req, res) => {
    if (fs.existsSync(KEYS_FILE)) res.json(JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8')));
    else res.json([]);
});
app.post('/api/keys', (req, res) => {
    fs.writeFileSync(KEYS_FILE, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ success: true });
});

// 2. 全局配置管理
app.get('/api/config', (req, res) => {
    res.json(getConfig());
});
app.post('/api/config', (req, res) => {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ success: true });
});

// 3. 测活接口
app.post('/api/check_balance', async (req, res) => {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: '请提供 Key' });
    
    const targetBase = getConfig().targetApi.replace(/\/$/, '');
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
    console.log(`\n🚀 全栈网关已启动!\n==================================================\n🌐 管理面板 : http://127.0.0.1:${PORT}\n🔌 API 接口 : http://127.0.0.1:${PORT}/v1\n🔑 统一 Key : ${conf.unifiedKey}\n🎯 目标 URL : ${conf.targetApi}\n==================================================\n`);
});
