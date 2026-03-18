# yunyunyunyun

# 硅基流动 API 密钥本地网关 (yunyunyunyun)

这是一个轻量级的本地 API 管理与代理网关，专为硅基流动 (SiliconFlow) API 设计。配合单文件 HTML 前端，实现 API Key 的安全存储、批量测活，并提供本地轮询代理服务。

## 🌟 核心功能
* **前端面板**：纯本地 HTML 运行，AES/XOR 加密存储 API 密钥，支持批量查询余额。
* **本地网关**：基于 Node.js，统一暴露一个本地 URL 和自定义统一 Key。
* **智能轮询**：自动在多个有效的 API Key 之间轮询请求，分摊额度，防止单点限流。

## 🚀 部署指南 (Termux/Linux/Mac/Win)

1. 克隆本项目：
   \`\`\`bash
   git clone https://github.com/liuyunyunhao/yunyunyunyun.git
   cd yunyunyunyun
   \`\`\`
2. 安装依赖并启动：
   \`\`\`bash
   npm install
   node proxy.js
   \`\`\`

## 💡 客户端使用说明 (如 Chatbox / NextChat)
* **API URL (自定义端点)**：`http://127.0.0.1:3000/v1` （如果跨设备，请替换为运行该代码设备的局域网 IP）
* **API Key**：填入您在 `proxy.js` 中设置的 `UNIFIED_KEY`。
