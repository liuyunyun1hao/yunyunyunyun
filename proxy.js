const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());

// ================= 配置区 =================
const PORT = 3000;
const TARGET_API = 'https://api.siliconflow.cn'; 
const UNIFIED_KEY = "sk-my-super-local-key"; 
const KEYS_FILE = path.join(__dirname, 'keys.json'); 
// ==========================================

// 1. 提供前端静态页面
app.use(express.static(__dirname));

// 2. 核心代理与轮询逻辑
let currentIndex = 0;

function getNextKey(keys) {
    const activeKeys = keys.filter(k => k.status === 'valid' && k.isPolling);
    if (activeKeys.length === 0) return null;
    const keyToUse = activeKeys[currentIndex % activeKeys.length].key;
    currentIndex++;
    return keyToUse;
}

// 【关键修复】代理中间件必须在 express.json() 之前挂载，否则会破坏请求的 Body！
const apiProxy = createProxyMiddleware({
    target: TARGET_API,
    changeOrigin: true,
    ws: true,
    onProxyReq: (proxyReq, req, res) => {
        let keys = [];
        if (fs.existsSync(KEYS_FILE)) {
            keys = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
        }

        const authHeader = req.headers.authorization;
        let finalKey = null;

        if (authHeader) {
            const token = authHeader.replace('Bearer ', '').trim();
            if (token === UNIFIED_KEY) {
                finalKey = getNextKey(keys);
                if(finalKey) console.log(`[轮询代理] ${req.method} 请求 -> 分配 Key: ${finalKey.substring(0, 8)}***`);
            } else {
                finalKey = token;
                console.log(`[单独调用] 客户端直接指定 Key: ${finalKey.substring(0, 8)}***`);
            }
        }

        if (finalKey) {
            proxyReq.setHeader('Authorization', `Bearer ${finalKey}`);
        }
    },
    onError: (err, req, res) => {
        console.error('[代理错误]', err);
        res.status(500).json({ error: "本地代理转发失败" });
    }
});

// 拦截所有 Chatbox/聊天软件 发来的 /v1 请求
app.use('/v1', apiProxy);

// 3. 解析器与独立 API 接口 (供我们的 HTML 管理页面调用)
app.use(express.json({ limit: '5mb' }));

app.get('/api/keys', (req, res) => {
    if (fs.existsSync(KEYS_FILE)) {
        res.json(JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8')));
    } else {
        res.json([]);
    }
});

app.post('/api/keys', (req, res) => {
    fs.writeFileSync(KEYS_FILE, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ success: true });
});

// 【关键新增】完全独立的测活与查余额接口，不经过代理，100% 稳定
app.post('/api/check_balance', async (req, res) => {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: '请提供 Key' });
    
    try {
        const response = await fetch('https://api.siliconflow.cn/v1/user/info', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${key}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (err) {
        console.error('API请求出错:', err);
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 硅基流动网关已重新启动!\n==================================================\n🌐 【管理面板】浏览器访问: http://127.0.0.1:${PORT}\n🔌 【API 接口】软件中填写: http://127.0.0.1:${PORT}/v1\n🔑 【统一 Key】软件中填写: ${UNIFIED_KEY}\n==================================================\n`);
});
