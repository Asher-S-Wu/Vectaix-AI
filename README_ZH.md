<div align="center">

<br/>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/%E2%9C%A6%20VECTAIX%20AI-%E4%B8%8B%E4%B8%80%E4%BB%A3%E6%99%BA%E8%83%BD-8B5CF6?style=for-the-badge&labelColor=1e1b4b">
  <img src="https://img.shields.io/badge/%E2%9C%A6%20VECTAIX%20AI-%E4%B8%8B%E4%B8%80%E4%BB%A3%E6%99%BA%E8%83%BD-8B5CF6?style=for-the-badge&labelColor=1e1b4b" alt="Vectaix AI" width="420"/>
</picture>

<br/><br/>

**AI 助手 · 对话、联网搜索与多媒体创作**

<br/>

[![Next.js 16](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=next.js&logoColor=white)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=flat-square&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![Zeabur](https://img.shields.io/badge/Zeabur-6300FF?style=flat-square)](https://zeabur.com/)

<br/>

[**English**](README.md)&nbsp;&nbsp;|&nbsp;&nbsp;[**简体中文**](README_ZH.md)&nbsp;&nbsp;|&nbsp;&nbsp;[**日本語**](README_JA.md)

<br/>

</div>

<br/>

---

<br/>

## 功能特性

### 🤖 Vectaix 助手

在输入框中写下问题，点击发送即可开始对话。Vectaix 保存聊天记录，逐步展示思考与回答，并提供回复朗读。聊天通过 DeepSeek 官方 API 使用 `deepseek-flash`。

### 🎨 媒体工作区

在媒体工作区中生成和编辑图片，并使用 Fish Audio S2.1 Pro Free 合成配音。

独立媒体模型：

| 模型 | 供应商 | 能力 |
|:---:|:---:|:---|
| **GPT Image 2.5** | Micu | 图片生成，以及使用参考图进行图片编辑 |
| **Fish Audio S2.1 Pro Free** (`s2.1-pro-free`) | Fish Audio | 多语言配音与音色选择；按输入文本的 UTF-8 字节数计费，每百万字节 0 美元 |

<br/>

### 🌐 联网搜索与浏览

支持搜索网页，并读取多个页面作为回答的参考。

- **智能搜索** — 通过免费的 TinyFish Search 查找最新网页，搜索语言跟随当前提问
- **网页内容提取** — 通过免费的 TinyFish Fetch 将选定页面提取为干净的 Markdown
- **多页浏览** — 一次回答中读取多个页面
- **行内引用** — 支持在回答中附上来源链接

搜索和网页读取不额外收费；AI 阅读资料和生成回答的模型调用费用另计。

<br/>

### 📎 私有媒体存储

媒体工作区将上传素材、生成的图片与语音保存到私有空间。文件所有者可以预览和下载自己的文件。

<br/>

### ✨ 对话与个性化设置

<table>
<tr>
<td width="50%">

**💬 对话管理**
- 基于 MongoDB 的持久化聊天记录
- 置顶重要对话
- 对话级别的记忆与技能设置

</td>
<td width="50%">

**🎨 主题与个性化**
- 深色 / 浅色模式，可跟随系统切换
- 可调节字体大小
- 完成提示音及音量控制
- 自定义用户头像

</td>
</tr>
<tr>
<td width="50%">

**📝 富文本 Markdown 渲染**
- 完整 GitHub Flavored Markdown (GFM)
- LaTeX 数学公式（KaTeX）
- 语法高亮代码块
- 可滚动表格，支持一键复制

</td>
<td width="50%">

**🔐 认证与安全**
- 基于 MongoDB 的服务端会话管理
- Bcrypt 密码哈希
- 限制登录和注册的请求频率
- 管理员用户管理面板

</td>
</tr>
<tr>
<td width="50%">

**⚙️ 高级控制**
- 自定义助手名称、回复语言和表达风格
- 设置对话指令，支持保存为模板
- 媒体分辨率设置

</td>
<td width="50%">

**📱 渐进式 Web 应用**
- 支持的浏览器可将网站添加到主屏幕
- 移动端优化的响应式 UI
- 触控友好的交互界面

</td>
</tr>
</table>

<br/>

---

<br/>

## 项目架构

```
vectaix-ai/
├── app/
│   ├── api/
│   │   ├── chat/             # 多供应商聊天
│   │   ├── auth/             # 认证端点
│   │   ├── conversations/    # 对话 CRUD
│   │   ├── media/            # 图片和语音创作
│   │   ├── upload/           # 私有硬盘文件上传
│   │   └── admin/            # 管理后台
│   ├── components/           # React UI 组件
│   │   ├── chat/             # 聊天输入与发送
│   │   ├── message/          # 消息展示组件
│   │   │   ├── MessageList.js
│   │   │   └── ...
│   └── ChatApp.js            # 根应用组件
├── lib/
│   ├── client/               # 客户端工具
│   │   ├── chat/             # 聊天操作与运行时
│   │   └── hooks/            # React Hooks（主题、设置）
│   ├── server/               # 服务端逻辑
│   │   ├── chat/             # 供应商适配器、配置、提示词
│   │   ├── webBrowsing/      # 联网搜索与抓取引擎
│   │   ├── storage/          # 挂载硬盘存储服务
│   │   └── conversations/    # 对话存储逻辑
│   └── shared/               # 共享常量与类型
│       ├── models.js         # 模型定义与能力
│       ├── attachments.js    # 文件类型处理
│       └── webSearch.js      # 搜索配置
├── models/                   # Mongoose 数据模型
│   ├── User.js
│   └── Conversation.js
└── public/                   # 静态资源
```

<br/>

---

<br/>

## 技术栈

<table>
<tr>
<td align="center" width="96"><img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/nextjs/nextjs-original.svg" width="48" height="48" alt="Next.js"/><br/><sub><b>Next.js 16</b></sub></td>
<td align="center" width="96"><img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/react/react-original.svg" width="48" height="48" alt="React"/><br/><sub><b>React 19</b></sub></td>
<td align="center" width="96"><img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/tailwindcss/tailwindcss-original.svg" width="48" height="48" alt="Tailwind"/><br/><sub><b>Tailwind CSS</b></sub></td>
<td align="center" width="96"><img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/mongodb/mongodb-original.svg" width="48" height="48" alt="MongoDB"/><br/><sub><b>MongoDB</b></sub></td>
<td align="center" width="96"><img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/nodejs/nodejs-original.svg" width="48" height="48" alt="Node.js"/><br/><sub><b>Node.js</b></sub></td>
</tr>
</table>

| 层级 | 技术 |
|:---|:---|
| **前端** | Next.js 16 · React 19 · Tailwind CSS · Framer Motion · Lucide Icons |
| **后端** | Next.js API Routes · Node.js · SSE（Server-Sent Events）流式传输 |
| **数据库** | MongoDB + Mongoose ODM |
| **存储** | Zeabur 挂载硬盘（私有媒体文件） |
| **AI 供应商** | Micu · 阿里云百炼 · 火山引擎 |
| **认证** | MongoDB 服务端会话 · bcryptjs |
| **渲染** | react-markdown · rehype-highlight · rehype-katex · remark-gfm · remark-math |
| **部署** | Zeabur 原生 Next.js 服务（单实例） |

<br/>

---

<br/>

## 快速开始

### 前置要求

- **Zeabur** 项目与 Git 仓库
- **MongoDB** 实例
- 至少一个 AI 供应商的 API 密钥

### Zeabur 部署

1. 在 Zeabur 中选择“部署源代码”并导入 Git 仓库，平台会自动识别 Next.js，并执行项目中的 npm 构建和启动命令。
2. 创建持久化卷 `vectaix-data`，挂载到 `/data`。
3. 将 HTTP 端口设置为 `3000`，健康检查路径设置为 `/api/health`。
4. 添加下列环境变量后重新部署。

### 环境变量

| 变量 | 必需 | 描述 |
|:---|:---:|:---|
| `MONGO_URI` | ✅ | MongoDB 连接字符串 |
| `STORAGE_ROOT` | ✅ | 挂载硬盘目录，Zeabur 使用 `/data/vectaix` |
| `ADMIN_EMAILS` | — | 管理员邮箱，多个邮箱使用英文逗号分隔 |
| `DEEPSEEK_API_KEY` | ✅ | 助手使用的 DeepSeek 官方 API 密钥（`deepseek-flash`） |
| `MICU_OPENAI_IMAGE_API_KEY` | — | Micu 图片服务 API 密钥 |
| `FISH_API_KEY` | — | Fish Audio 官方 API 密钥，启用 S2.1 Pro Free 配音时配置 |
| `PUBLIC_APP_URL` | — | 已部署应用的公网 HTTPS 地址；通行密钥登录时需要 |
| `APP_SECRETS_KEY` | — | 用于加密外部连接凭据、浏览器登录状态和定时备份密码；启用这些功能时需要。值为 32 字节随机密钥的 Base64 编码，请妥善保存 |
| `TINYFISH_API_KEY` | — | TinyFish 免费 Search 与 Fetch 接口共用的 API 密钥，启用联网时必需 |

> [!TIP]
> 配置助手密钥，以及实际使用的媒体和联网功能所需密钥。

<br/>

---

<br/>

<div align="center">

<br/>

### ⭐ Star 趋势

<a href="https://star-history.com/#Noah-Wu66/Vectaix-AI&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date" width="600" />
  </picture>
</a>

<br/><br/>

**如果你觉得 Vectaix AI 有用，请给一个 ⭐ 吧！**

[![GitHub Stars](https://img.shields.io/github/stars/Noah-Wu66/Vectaix-AI?style=for-the-badge&logo=github&logoColor=white&label=Stars&color=fbbf24)](https://github.com/Noah-Wu66/Vectaix-AI/stargazers)
&nbsp;
[![GitHub Forks](https://img.shields.io/github/forks/Noah-Wu66/Vectaix-AI?style=for-the-badge&logo=github&logoColor=white&label=Forks&color=60a5fa)](https://github.com/Noah-Wu66/Vectaix-AI/network/members)

<br/>

<br/>

</div>
