# yunyunyunyun

# 🚀 硅基流动 API 密钥本地管理网关 (SiliconFlow Key Manager)

这是一个专为“硅基流动 (SiliconFlow)”打造的轻量级本地 API 管理与代理网关。采用 Node.js 驱动后端，搭配精美的 Vue + Element UI 响应式前端。

无论是在电脑端还是通过 Termux 部署在旧手机上，它都能为您提供稳定、安全且抗限流的 API 代理服务。

## ✨ 核心功能亮点

* 📱 **完美适配移动端**：抛弃传统表格，采用现代化响应式卡片网格布局，手机端一屏尽览，告别横向滑动。
* 🔄 **智能轮询与负载均衡**：将多个 API Key 放入池中，网关会自动在有效的 Key 之间轮询转发，避免单一账号因高频调用被限流。
* 💰 **全自动余额监控**：一键批量测活并查询所有 Key 的准确余额，卡片会根据余额从小到大自动平滑排序。
* 🛡️ **隐私与安全保护**：您可以自定义对外的“统一虚拟 Key”（如 `sk-my-password`），真实的 API Key 仅保存在本地，彻底杜绝泄露风险。
* 🧹 **智能去重与管理**：支持自定义 Key 名称（如“我的主号”、“备用号”），支持一键清理重复导入的 Key，支持一键全开/全关轮询。
* 🤖 **无缝对接各大 AI 客户端**：原生适配 Chatbox、SillyTavern 酒馆等第三方软件，甚至为其专门开辟了 `/v1/models` 模型列表的直连拉取通道，100% 成功加载官方模型库。

## 🛠️ Termux 手机端部署教程 (零基础)

如果您想把闲置的安卓手机变成随身 API 服务器，请下载并打开 [Termux](https://f-droid.org/packages/com.termux/)，然后依次执行以下步骤：

**1. 准备基础环境**
\`\`\`bash
pkg update && pkg upgrade -y
pkg install nodejs git -y
\`\`\`

**2. 克隆本仓库**
\`\`\`bash
git clone https://github.com/liuyunyun1hao/yunyunyunyun.git
\`\`\`

**3. 进入目录并安装依赖**
\`\`\`bash
cd yunyunyunyun
npm install
\`\`\`

**4. 启动网关**
\`\`\`bash
node proxy.js
\`\`\`
> 🎉 看到 `🚀 全栈网关已启动!` 提示后，打开手机浏览器访问 `http://127.0.0.1:3000` 即可进入管理面板！

## 🔌 客户端配置指南 (以 Chatbox / 酒馆为例)

在启动网关后，前往您的聊天软件进行如下设置：
* **API 接口地址 (API URL)**：`http://127.0.0.1:3000/v1` （*如果跨设备调用，请将 127.0.0.1 替换为运行本程序的手机局域网 IP*）
* **API 密钥 (API Key)**：填入您在管理面板的 `[⚙️ 网关配置]` 中设置的**自定义统一 Key**（默认是 `sk-my-super-local-key`）。

接下来，尽情享受丝滑的 AI 对话吧！

⚡ Termux “一键更新并启动” 终极配置
每次在 Termux 里都要敲 cd yunyunyunyun 然后 git pull 再 node proxy.js 确实很麻烦。我们可以利用 Linux 的快捷命令 (alias) 功能，把它变成一个超级短的命令。
请在您的 Termux 终端中依次执行以下两行代码（直接复制粘贴并回车）：
echo "alias upapi='cd ~/yunyunyunyun && git pull && node proxy.js'" >> ~/.bashrc
source ~/.bashrc

配置完成了！ 以后，当您在 GitHub 上修改了代码，或者您刚刚打开 Termux 准备启动服务时，您只需要在键盘上输入这 5 个字母：
upapi

按下回车，它就会瞬间全自动完成：进入文件夹 -> 自动拉取 GitHub 最新代码 -> 启动本地代理服务！
