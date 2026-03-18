const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
app.use(cors());

// ================= 配置区 =================
const PORT = 3000; // 本地 API 端口
const LOCAL_URL = `http://127.0.0.1:${PORT}`;
const TARGET_API = 'https://api.siliconflow.cn'; // 硅基流动官方接口

// 1. 设置您统一对外的 API Key
const UNIFIED_KEY = "sk-my-super-local-key"; 

// 2. 填入您在 HTML 管理工具中测活有效的硅基流动 Keys
const REAL_KEYS = [
    "sk-aaaaa11111bbbbb22222",
    "sk-ccccc33333ddddd44444",
    "sk-eeeee55555fffff66666"
];
// ==========================================

let currentIndex = 0;

// 获取下一个轮询的 Key
function getNextKey() {
    if (REAL_KEYS.length === 0) return null;
    const key = REAL_KEYS[currentIndex];
    currentIndex = (currentIndex + 1) % REAL_KEYS.length; // 循环递增
    return key;
}

// 自定义代理中间件
const apiProxy = createProxyMiddleware({
    target: TARGET_API,
    changeOrigin: true,
    ws: true, // 支持 WebSocket
    onProxyReq: (proxyReq, req, res) => {
        // 获取客户端请求头中的 Authorization
        const authHeader = req.headers.authorization;
        let finalKey = null;

        if (authHeader) {
            const token = authHeader.replace('Bearer ', '').trim();
            
            if (token === UNIFIED_KEY) {
                // 【情况 1】客户端使用的是"统一 Key"，执行轮询策略
                finalKey = getNextKey();
                console.log(`[轮询调用] 客户端使用统一 Key，已自动分配底层 Key: ${finalKey.substring(0, 8)}***`);
            } else if (REAL_KEYS.includes(token)) {
                // 【情况 2】客户端直接使用了某一个具体的底层 Key，允许直接穿透
                finalKey = token;
                console.log(`[单独调用] 客户端指定使用 Key: ${finalKey.substring(0, 8)}***`);
            } else {
                console.log(`[拦截] 无效的 API Key: ${token}`);
            }
        }

        // 重写 Authorization 头，使用真实的硅基流动 Key 转发请求
        if (finalKey) {
            proxyReq.setHeader('Authorization', `Bearer ${finalKey}`);
        }
    },
    onError: (err, req, res) => {
        res.status(500).json({ error: "本地代理服务转发失败" });
    }
});

// 拦截所有发往 /v1/ 的请求（兼容 OpenAI 格式）
app.use('/v1', apiProxy);

app.listen(PORT, () => {
    console.log(`
🚀 本地 API 网关已启动!
==================================================
🌐 本地接口地址 : ${LOCAL_URL}/v1
🔑 统一 API Key : ${UNIFIED_KEY}
📦 当前挂载 Key : ${REAL_KEYS.length} 个
==================================================
💡 使用说明:
1. 在其他软件(如 Chatbox)中，将 API 域名设置为 ${LOCAL_URL}/v1
2. 填入统一 Key [ ${UNIFIED_KEY} ] 即可实现轮询。
3. 如果填入具体的硅基流动 Key，则只会调用该 Key。
    `);
});
