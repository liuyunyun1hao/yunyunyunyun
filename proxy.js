/**
 * 硅基流动 API 自定义轮询代理脚本
 * 环境要求：已安装 Node.js (无需 npm install 任何依赖)
 * 运行方式：node proxy.js
 */

const http = require('http');
const https = require('https');

// ================= 1. 配置区 (请在这里修改) =================

// 填入你的硅基流动 API Keys (必须保留引号和逗号)
const apiKeys = [
    "sk-你的第一个key填在这里",
    "sk-你的第二个key填在这里",
    "sk-你的第三个key填在这里"
];

// 自定义轮询次数 (1-20)：每个 Key 连续处理多少条消息后更换为下一个
const MAX_REQUESTS_PER_KEY = 5;

// 代理服务监听的本地端口 (默认 8080，如冲突可改为 3000、8081 等)
const LOCAL_PORT = 8080;

// 硅基流动 API 基础地址 (请勿修改)
const TARGET_BASE_URL = "https://api.siliconflow.cn";

// ================= 2. 核心状态管理 (请勿修改) =================

let currentKeyIndex = 0;
let currentRequestCount = 0;

// 获取下一个 Key，并处理轮询计数
function getNextKey() {
    if (!apiKeys || apiKeys.length === 0) {
        console.error("❌ 错误：未配置 API Key！请在代码最上方填写。");
        return null;
    }

    // 提取当前准备使用的 Key
    const keyToUse = apiKeys[currentKeyIndex];
    
    // 调用次数 +1
    currentRequestCount++;

    console.log(`[请求到达] 正在使用 Key[${currentKeyIndex + 1}/${apiKeys.length}] | 当前 Key 进度: ${currentRequestCount}/${MAX_REQUESTS_PER_KEY}`);

    // 判断是否达到自定义更换阈值
    if (currentRequestCount >= MAX_REQUESTS_PER_KEY) {
        // 达到阈值，索引加1并取模（确保到底后回到第1个）
        currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
        // 重置调用次数
        currentRequestCount = 0;
        console.log(`🔄 达到设定次数 [${MAX_REQUESTS_PER_KEY}]，已自动切换至下一个 Key[${currentKeyIndex + 1}]`);
    }

    return keyToUse;
}

// ================= 3. 本地代理服务 (请勿修改) =================

const server = http.createServer((clientReq, clientRes) => {
    // 允许跨域 (CORS)，确保前端调用不会被拦截
    clientRes.setHeader('Access-Control-Allow-Origin', '*');
    clientRes.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    clientRes.setHeader('Access-Control-Allow-Headers', '*');

    // 处理预检请求
    if (clientReq.method === 'OPTIONS') {
        clientRes.writeHead(200);
        return clientRes.end();
    }

    // 获取当前该用的 API Key
    const apiKey = getNextKey();
    if (!apiKey) {
        clientRes.writeHead(500, { 'Content-Type': 'application/json' });
        return clientRes.end(JSON.stringify({ error: "代理脚本未配置 API Key" }));
    }

    // 解析请求目标地址
    const targetUrl = new URL(TARGET_BASE_URL + clientReq.url);
    
    // 构建转发给硅基流动的请求头
    const options = {
        hostname: targetUrl.hostname,
        port: targetUrl.port || 443,
        path: targetUrl.pathname + targetUrl.search,
        method: clientReq.method,
        headers: {
            ...clientReq.headers,
            'host': targetUrl.hostname,
            'authorization': `Bearer ${apiKey}` // 核心：注入计算好的 Key
        }
    };

    // 剔除可能干扰请求的头信息
    delete options.headers['accept-encoding']; // 避免压缩导致流读取失败
    delete options.headers['content-length'];  // 重新计算长度

    // 收集客户端发来的数据体 (例如聊天的 prompt)
    let body = [];
    clientReq.on('data', (chunk) => body.push(chunk));

    clientReq.on('end', () => {
        const requestBody = Buffer.concat(body);
        if (requestBody.length > 0) {
            options.headers['content-length'] = Buffer.byteLength(requestBody);
        }

        // 发起真实的 HTTPS 请求到硅基流动
        const proxyReq = https.request(options, (proxyRes) => {
            clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
            // 将硅基流动的响应流式转发回客户端（支持流式生成）
            proxyRes.pipe(clientRes, { end: true });
        });

        proxyReq.on('error', (err) => {
            console.error(`❌ 请求硅基流动失败: ${err.message}`);
            if (!clientRes.headersSent) {
                clientRes.writeHead(502, { 'Content-Type': 'application/json' });
                clientRes.end(JSON.stringify({ error: "网关错误", details: err.message }));
            }
        });

        // 写入请求体并发送
        if (requestBody.length > 0) {
            proxyReq.write(requestBody);
        }
        proxyReq.end();
    });
});

// 启动服务
server.listen(LOCAL_PORT, () => {
    console.log(`\n======================================================`);
    console.log(`✅ 自定义轮询代理服务已成功启动！`);
    console.log(`🚀 本地监听端口: ${LOCAL_PORT}`);
    console.log(`⚙️  当前配置: 共 ${apiKeys.length} 个 Key参与轮询`);
    console.log(`🔄 切换规则: 每个 Key 连续处理 ${MAX_REQUESTS_PER_KEY} 条消息后切换`);
    console.log(`------------------------------------------------------`);
    console.log(`👉 【下一步操作说明】：`);
    console.log(`请在你的前端应用中，将 API 的代理地址/自定义端点修改为：`);
    console.log(`http://127.0.0.1:${LOCAL_PORT}`);
    console.log(`======================================================\n`);
});
