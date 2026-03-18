const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// ================= 配置区 =================
const PORT = 3000;
const TARGET_API = 'https://api.siliconflow.cn'; 
const UNIFIED_KEY = "sk-my-super-local-key"; // 你对外使用的统一万能钥匙
const KEYS_FILE = path.join(__dirname, 'keys.json'); // 存储Key的文件
// ==========================================

// 1. 让 Node.js 兼职网页服务器，把当前目录下的 index.html 发给浏览器
app.use(express.static(__dirname));

// 2. 提供给前端网页调用的 API：获取和保存 Key 列表
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

// 3. 核心代理与轮询逻辑
let currentIndex = 0;

function getNextKey(keys) {
    // 过滤出状态有效，并且开启了"参与轮询"的 Key
    const activeKeys = keys.filter(k => k.status === 'valid' && k.isPolling);
    if (activeKeys.length === 0) return null;
    
    const keyToUse = activeKeys[currentIndex % activeKeys.length].key;
    currentIndex++;
    return keyToUse;
}

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
                // 如果客户端填的是统一Key，执行轮询
                finalKey = getNextKey(keys);
                if(finalKey) console.log(`[轮询转发] 使用底层 Key: ${finalKey.substring(0, 8)}***`);
            } else {
                // 如果客户端直接填了真实的Key，直接穿透（单独认定一个key使用）
                finalKey = token;
                console.log(`[单独调用] 客户端指定 Key: ${finalKey.substring(0, 8)}***`);
            }
        }

        if (finalKey) {
            proxyReq.setHeader('Authorization', `Bearer ${finalKey}`);
        }
    },
    onError: (err, req, res) => {
        res.status(500).json({ error: "本地代理服务转发失败" });
    }
});

// 拦截所有发往 /v1 的请求
app.use('/v1', apiProxy);

// 监听所有网卡 (0.0.0.0)，方便局域网其他设备访问
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
🚀 全栈网关已启动!
==================================================
🌐 【管理面板】请在浏览器打开: http://127.0.0.1:${PORT}
🔌 【API 接口】请在Chatbox填 : http://127.0.0.1:${PORT}/v1
🔑 【统一 Key】请在Chatbox填 : ${UNIFIED_KEY}
==================================================
    `);
});
