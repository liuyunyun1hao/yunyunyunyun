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

app.use(express.static(__dirname));

let currentIndex = 0;

function getNextKeyObj(keys) {
    const activeKeys = keys.filter(k => k.status === 'valid' && k.isPolling);
    if (activeKeys.length === 0) return null;
    const keyObj = activeKeys[currentIndex % activeKeys.length];
    currentIndex++;
    return keyObj;
}

// 【全新增加：专属的模型列表拉取通道】
// 专门处理聊天软件发来的获取模型列表请求，确保 100% 拉取成功
app.get(['/v1/models', '/models'], async (req, res) => {
    let keys = [];
    if (fs.existsSync(KEYS_FILE)) {
        keys = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
    }
    
    // 找出一个有效的 Key 去请求模型列表
    const validKeys = keys.filter(k => k.status === 'valid');
    if (validKeys.length === 0) {
        return res.status(500).json({ error: "本地网关中没有有效的 API Key，无法获取模型列表" });
    }
    
    const keyToUse = validKeys[0].key; // 取第一个有效 Key 即可
    
    try {
        console.log(`[拉取模型] 正在为您从硅基流动官方获取最新模型列表...`);
        const response = await fetch('https://api.siliconflow.cn/v1/models', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${keyToUse}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        res.status(response.status).json(data);
        console.log(`[拉取模型] 成功！已将模型列表返回给客户端。`);
    } catch (err) {
        console.error('[拉取模型错误]', err);
        res.status(500).json({ error: "获取模型列表失败" });
    }
});

// 对话等其他 API 请求的代理通道
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
                const keyObj = getNextKeyObj(keys);
                if(keyObj) {
                    finalKey = keyObj.key;
                    console.log(`[轮询] 分配 -> [${keyObj.name || '未命名'}] ${finalKey.substring(0, 8)}***`);
                }
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

// 拦截发往 /v1 的请求 (排除了上面的 /v1/models)
app.use('/v1', apiProxy);

// JSON 解析器用于我们自己的本地管理接口
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

// 网页端的单独测活接口
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
