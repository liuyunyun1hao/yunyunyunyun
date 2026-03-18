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

// 读取全局配置，新增 pollingLimit (默认每次换Key)
function getConfig() {
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            const conf = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            if (!conf.pollingLimit) conf.pollingLimit = 1; // 兼容旧配置
            return conf;
        } catch (e) {}
    }
    return { unifiedKey: "sk-my-super-local-key", targetApi: "https://api.siliconflow.cn", pollingLimit: 1 };
}

app.use(express.static(__dirname));

// 全局请求总数计数器
let totalRequestCount = 0; 

// 【核心升级】带次数限制的轮询算法
function getNextKeyInfo(keys, limit) {
    const activeKeys = keys.filter(k => k.status === 'valid' && k.isPolling);
    if (activeKeys.length === 0) return null;

    // 算法：向下取整(总请求数 / 限制次数) % 有效Key的数量
    const keyIndex = Math.floor(totalRequestCount / limit) % activeKeys.length;
    const keyObj = activeKeys[keyIndex];

    // 当前是这个Key在这一轮中的第几次调用
    const currentUsage = (totalRequestCount % limit) + 1;
    
    // 计数器加1，为下一次请求做准备
    totalRequestCount++;

    return { keyObj, currentUsage, limit };
}

// 专属模型拉取通道 (不计入轮询次数)
app.get(['/v1/models', '/models'], async (req, res) => {
    let keys = [];
    if (fs.existsSync(KEYS_FILE)) keys = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
    
    const validKeys = keys.filter(k => k.status === 'valid');
    if (validKeys.length === 0) return res.status(500).json({ error: "没有有效 API Key" });
    
    const keyToUse = validKeys[0].key; 
    const targetBase = getConfig().targetApi.replace(/\/$/, '');
    
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

// 对话代理中间件
const apiProxy = createProxyMiddleware({
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
            
            if (token === currentConfig.unifiedKey) {
                // 执行带次数限制的轮询
                const info = getNextKeyInfo(keys, currentConfig.pollingLimit);
                if(info && info.keyObj) {
                    finalKey = info.keyObj.key;
                    console.log(`[轮询进度 ${info.currentUsage}/${info.limit}次] -> [${info.keyObj.name || '未命名'}] ${finalKey.substring(0, 8)}***`);
                }
            } else {
                finalKey = token;
                console.log(`[直连指定] -> Key: ${finalKey.substring(0, 8)}***`);
            }
        }

        if (finalKey) proxyReq.setHeader('Authorization', `Bearer ${finalKey}`);
    },
    onError: (err, req, res) => res.status(500).json({ error: "本地代理转发失败" })
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
    // 重置总请求计数，确保修改配置后立刻重新开始计算
    totalRequestCount = 0; 
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ success: true });
});

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
    console.log(`\n🚀 全栈网关已启动!\n==================================================\n🌐 管理面板 : http://127.0.0.1:${PORT}\n🔌 API 接口 : http://127.0.0.1:${PORT}/v1\n🔑 统一 Key : ${conf.unifiedKey}\n🔄 轮询频率 : 每个Key连续调用 ${conf.pollingLimit} 次后切换\n==================================================\n`);
});
