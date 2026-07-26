<div align="center">

<br/>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/%E2%9C%A6%20VECTAIX%20AI-%E4%B8%8B%E4%B8%80%E4%BB%A3%E6%99%BA%E8%83%BD-8B5CF6?style=for-the-badge&labelColor=1e1b4b">
  <img src="https://img.shields.io/badge/%E2%9C%A6%20VECTAIX%20AI-%E4%B8%8B%E4%B8%80%E4%BB%A3%E6%99%BA%E8%83%BD-8B5CF6?style=for-the-badge&labelColor=1e1b4b" alt="Vectaix AI" width="420"/>
</picture>

<br/><br/>

**多模型 AI 聊天平台 · 对话、联网搜索与多媒体创作**

<br/>

[![Next.js 16](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=next.js&logoColor=white)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=flat-square&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![Zeabur](https://img.shields.io/badge/Zeabur-6300FF?style=flat-square)](https://zeabur.com/)
[![License: MIT](https://img.shields.io/badge/许可证-MIT-22c55e?style=flat-square)](LICENSE)

<br/>

[**English**](README.md)&nbsp;&nbsp;|&nbsp;&nbsp;[**简体中文**](README_ZH.md)&nbsp;&nbsp;|&nbsp;&nbsp;[**日本語**](README_JA.md)

<br/>

<table>
<tr>
<td align="center" width="150"><img src="https://img.shields.io/badge/-GPT--5.6%20Sol-412991?style=for-the-badge&logo=openai&logoColor=white" alt="GPT-5.6 Sol"/><br/><sub><b>OpenAI</b></sub></td>
<td align="center" width="150"><img src="https://img.shields.io/badge/-Claude%20Opus%205-D97757?style=for-the-badge&logo=anthropic&logoColor=white" alt="Claude"/><br/><sub><b>Anthropic</b></sub></td>
<td align="center" width="150"><img src="https://img.shields.io/badge/-Gemini%203.6%20Flash-4285F4?style=for-the-badge&logo=google&logoColor=white" alt="Gemini"/><br/><sub><b>Google</b></sub></td>
<td align="center" width="150"><img src="https://img.shields.io/badge/-Grok%204.5-111111?style=for-the-badge&logo=x&logoColor=white" alt="Grok 4.5"/><br/><sub><b>xAI</b></sub></td>
</tr>
<tr>
<td align="center" width="150"><img src="https://img.shields.io/badge/-GPT%20Image%202-412991?style=for-the-badge&logo=openai&logoColor=white" alt="GPT Image 2"/><br/><sub><b>OpenAI</b></sub></td>
<td align="center" width="150"><img src="https://img.shields.io/badge/-Seedance%202.0-FF6A00?style=for-the-badge&logoColor=white" alt="Seedance"/><br/><sub><b>字节跳动</b></sub></td>
<td align="center" width="150"><img src="https://img.shields.io/badge/-Kimi%20K3-2563EB?style=for-the-badge&logoColor=white" alt="Kimi K3"/><br/><sub><b>Moonshot AI</b></sub></td>
</tr>
</table>

</div>

<br/>

---

<br/>

## 项目概述

**Vectaix AI** 是一个生产级的多模型 AI 聊天平台，将全球领先的语言模型汇聚于一个优雅的统一界面。不再局限于单一 AI 服务商，Vectaix 让你自由地在多个前沿模型之间切换。

<br/>

---

<br/>

## 功能特性

### 🤖 多模型智能

支持 6 个聊天模型，通过统一界面访问。对话中切换模型时会新建话题，避免不同模型的上下文相互混淆。

| 模型 | 供应商 | 上下文窗口 | 输入类型 | 深度思考 | 联网搜索 |
|:---:|:---:|:---:|:---:|:---:|:---:|
| **自动路由（均衡）** | AIHubMix | 动态 | 文本、图像 | ✅ | ✅ |
| **GPT-5.6 Sol** | OpenAI | 105 万 | 文本、图像 | ✅ | ✅ |
| **Claude Opus 5** | Anthropic | 100 万 | 文本、图像 | ✅ | ✅ |
| **Gemini 3.6 Flash** | Google | 100 万 | 文本、图像、音频、视频 | ✅ | ✅ |
| **Grok 4.5** | xAI | 50 万 | 文本、图像 | ✅ | ✅ |
| **Kimi K3** | Moonshot AI | 100 万 | 文本、图像 | ✅ | ✅ |

独立媒体模型：

| 模型 | 供应商 | 能力 |
|:---:|:---:|:---|
| **GPT Image 2** | OpenAI | 图片生成和图片编辑 |
| **Seedance 2.0 标准版** | 字节跳动 | 文生视频和图生视频 |

<br/>

### 🌐 联网搜索与浏览

具备实时互联网访问能力，支持智能多轮浏览。

- **智能搜索** — 通过 Firecrawl Search 发现最新、相关的网页来源
- **网页抓取** — 通过 Firecrawl Scrape 将选定页面提取为干净的 Markdown
- **多页浏览** — 单次会话中抓取多个页面
- **行内引用** — 每个论点都有可溯源的参考链接

<br/>

### 📎 私有多媒体文件

上传到 Zeabur 挂载硬盘中的私有媒体文件。

| 文件类型 | 支持格式 | 能力 |
|:---|:---|:---|
| 🖼️ **图像** | PNG, JPG, GIF, WebP | 视觉分析、OCR、图像描述 |
| 🎵 **音频** | MP3、WAV、M4A、AAC、OGG | Gemini 音频理解 |
| 🎬 **视频** | MP4、MOV、WebM、M4V | Gemini 视频理解 |

<br/>

### ✨ 精致的用户体验

<table>
<tr>
<td width="50%">

**💬 对话管理**
- 基于 MongoDB 的持久化聊天记录
- 智能长对话压缩
- 置顶重要对话
- 对话级别的模型与设置

</td>
<td width="50%">

**🎨 主题与个性化**
- 深色 / 浅色模式，丝滑过渡
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
- 全端点限速保护
- 管理员用户管理面板

</td>
</tr>
<tr>
<td width="50%">

**⚙️ 高级控制**
- 按模型调节思考深度
- 最大输出 Token 数控制
- 自定义系统提示词，支持预设
- 媒体分辨率设置

</td>
<td width="50%">

**📱 渐进式 Web 应用**
- 可安装到任何设备
- 移动端优化的响应式 UI
- 触控友好的交互界面
- 离线可用的 PWA 清单

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
│   │   ├── chat/             # 多供应商聊天与压缩
│   │   ├── auth/             # 认证端点
│   │   ├── conversations/    # 对话 CRUD
│   │   ├── media/            # 图片/视频生成
│   │   ├── upload/           # 私有硬盘文件上传
│   │   └── admin/            # 管理后台
│   ├── components/           # React UI 组件
│   │   ├── chat/             # 聊天输入与模型选择
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
| **前端** | Next.js 16 · React 19 · Tailwind CSS · Framer Motion · Ant Design · Lucide Icons |
| **后端** | Next.js API Routes · Node.js · SSE（Server-Sent Events）流式传输 |
| **数据库** | MongoDB + Mongoose ODM |
| **存储** | Zeabur 挂载硬盘（私有媒体文件） |
| **AI 供应商** | AIHubMix · Inferera · Google Gemini API |
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
| `AIHUBMIX_API_KEY` | — | AIHubMix 自动路由、通过 Anthropic Messages 调用的 Kimi K3，以及 Inferera 的 GPT、Grok、Claude、图片和视频共用的 API 密钥 |
| `GEMINI_API_KEY` | — | Gemini 聊天与对话压缩使用的 Google Gemini API 密钥 |
| `FIRECRAWL_API_KEY` | — | Firecrawl Search 与 Scrape 使用的 API 密钥 |

> [!TIP]
> 请为实际启用的模型或功能配置对应密钥；缺少密钥时接口会返回明确的配置错误。

<br/>

---

<br/>

## 许可证

本项目基于 [MIT 许可证](LICENSE) 开源。

<br/>

---

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

<sub>以智能构建，让创作更自由。</sub>

<br/>

</div>
