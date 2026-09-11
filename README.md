<div align="center">

<br/>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/%E2%9C%A6%20VECTAIX%20AI-Chat%20%26%20Media-8B5CF6?style=for-the-badge&labelColor=1e1b4b">
  <img src="https://img.shields.io/badge/%E2%9C%A6%20VECTAIX%20AI-Chat%20%26%20Media-8B5CF6?style=for-the-badge&labelColor=1e1b4b" alt="Vectaix AI" width="420"/>
</picture>

<br/><br/>

**Multi-Model AI Chat Platform for Conversations, Web Search, and Media Creation**

<br/>

[![Next.js 16](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=next.js&logoColor=white)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=flat-square&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![Zeabur](https://img.shields.io/badge/Zeabur-6300FF?style=flat-square)](https://zeabur.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](LICENSE)

<br/>

[**English**](README.md)&nbsp;&nbsp;|&nbsp;&nbsp;[**简体中文**](README_ZH.md)&nbsp;&nbsp;|&nbsp;&nbsp;[**日本語**](README_JA.md)

<br/>

<table>
<tr>
<td align="center" width="150"><img src="https://img.shields.io/badge/-GPT--6%20Astra-412991?style=for-the-badge&logo=openai&logoColor=white" alt="GPT-6 Astra"/><br/><sub><b>OpenAI</b></sub></td>
<td align="center" width="150"><img src="https://img.shields.io/badge/-Claude%20Opus%205-D97757?style=for-the-badge&logo=anthropic&logoColor=white" alt="Claude"/><br/><sub><b>Anthropic</b></sub></td>
<td align="center" width="150"><img src="https://img.shields.io/badge/-Gemini%203.8%20Flash-4285F4?style=for-the-badge&logo=google&logoColor=white" alt="Gemini"/><br/><sub><b>Google</b></sub></td>
<td align="center" width="150"><img src="https://img.shields.io/badge/-Grok%204.6-111111?style=for-the-badge&logo=x&logoColor=white" alt="Grok 4.6"/><br/><sub><b>xAI</b></sub></td>
</tr>
<tr>
<td align="center" width="150"><img src="https://img.shields.io/badge/-Qwen%20Image%203.0%20Pro-615CED?style=for-the-badge&logoColor=white" alt="Qwen Image 3.0 Pro"/><br/><sub><b>Alibaba Cloud</b></sub></td>
<td align="center" width="150"><img src="https://img.shields.io/badge/-HappyHorse-615CED?style=for-the-badge&logoColor=white" alt="HappyHorse"/><br/><sub><b>Alibaba Cloud</b></sub></td>
<td align="center" width="150"><img src="https://img.shields.io/badge/-Kimi%20K3-2563EB?style=for-the-badge&logoColor=white" alt="Kimi K3"/><br/><sub><b>Moonshot AI</b></sub></td>
<td align="center" width="150"><img src="https://img.shields.io/badge/-Qwen%203.8%20Max%200902-615CED?style=for-the-badge&logoColor=white" alt="Qwen 3.8 Max 0902"/><br/><sub><b>Alibaba Cloud</b></sub></td>
</tr>
</table>

</div>

<br/>

---

<br/>

## Overview

**Vectaix AI** supports multi-model chat, web search, and image, video, and speech creation.

<br/>

---

<br/>

## Features

### 🤖 Multi-Model Chat

Access 6 chat models through a unified interface. Switching models starts a new conversation with its own chat history.

| Model | Provider | Context Window | Inputs | Thinking | Web Search |
|:---:|:---:|:---:|:---:|:---:|:---:|
| **GPT-6 Astra** | OpenAI | 1,000,000 | Text, Image | ✅ | ✅ |
| **Claude Opus 5** | Anthropic | 1,000,000 | Text, Image | ✅ | ✅ |
| **Gemini 3.8 Flash** | Google | 1,000,000 | Text, Image, Audio, Video | ✅ | ✅ |
| **Grok 4.6** | xAI | 256,000 | Text, Image | ✅ | ✅ |
| **Kimi K3** | Moonshot AI | 262,144 | Text, Image | ✅ | ✅ |
| **Qwen 3.8 Max 0902** | Alibaba Cloud | 262,144 | Text, Image | ✅ | ✅ |

Dedicated media models:

| Model | Provider | Capability |
|:---:|:---:|:---|
| **Qwen Image 3.0 Pro** | Alibaba Cloud | Image generation and editing with 1–3 reference images |
| **HappyHorse 1.1 / Video Edit 1.0** | Alibaba Cloud | Text-to-video, first-frame-to-video, multi-reference-to-video, and video editing |
| **AI MediaKit Video Enhancement** | Volcengine | Generative quality enhancement for local videos or public HTTPS URLs at 720p, 1080p, or 2K; results are saved to private storage |
| **Qwen Audio 3.0 TTS Plus** | Alibaba Cloud | Multilingual speech synthesis, expression control, and voice cloning |
| **MiniMax Speech 2.8 HD / Turbo** | Alibaba Cloud | Emotional speech synthesis, system voices, and private voice cloning |

<br/>

### 🌐 Web Browsing & Search

Search the web and read multiple pages to inform answers.

- **Smart Search** — Discover fresh sources with free TinyFish Search in the language of the current question
- **Page Content** — Extract selected pages as clean Markdown with free TinyFish Fetch
- **Multi-Page Browsing** — Crawl multiple pages in a single session
- **Inline Citations** — Answers can include links to supporting sources

Search and page fetching have no additional fee. Model calls used to read sources and generate answers are billed separately.

<br/>

### 📎 Private Multimodal Files

Upload private media files stored on the Zeabur mounted disk.

| File Type | Supported Formats | Capability |
|:---|:---|:---|
| 🖼️ **Images** | PNG, JPG, GIF, WebP | Visual analysis, OCR, description |
| 🎵 **Audio** | MP3, WAV, M4A, AAC, OGG | Gemini audio understanding |
| 🎬 **Video** | MP4, MOV, WebM, M4V | Gemini video understanding |

<br/>

### ✨ Chat & Personalization

<table>
<tr>
<td width="50%">

**💬 Conversation Management**
- Persistent chat history with MongoDB
- Pin important conversations
- Conversation-specific model & settings

</td>
<td width="50%">

**🎨 Themes & Customization**
- Dark / Light mode with a system preference option
- Adjustable font size
- Completion sound with volume control
- Custom user avatars

</td>
</tr>
<tr>
<td width="50%">

**📝 Rich Markdown Rendering**
- Full GitHub Flavored Markdown (GFM)
- LaTeX math equations (KaTeX)
- Syntax-highlighted code blocks
- Scrollable tables with copy support

</td>
<td width="50%">

**🔐 Authentication & Security**
- MongoDB-backed server session management
- Bcrypt password hashing
- Rate limits for login and registration
- Admin user management panel

</td>
</tr>
<tr>
<td width="50%">

**⚙️ Advanced Controls**
- Custom assistant name, response language, and writing style
- Conversation instructions with saved templates
- Media resolution settings

</td>
<td width="50%">

**📱 Progressive Web App**
- Add to the home screen in supported browsers
- Mobile-optimized responsive UI
- Touch-friendly interface

</td>
</tr>
</table>

<br/>

---

<br/>

## Architecture

```
vectaix-ai/
├── app/
│   ├── api/
│   │   ├── chat/             # Multi-provider chat
│   │   ├── auth/             # Authentication endpoints
│   │   ├── conversations/    # Conversation CRUD
│   │   ├── media/            # Image/video generation
│   │   ├── upload/           # Private disk file upload
│   │   └── admin/            # Admin management
│   ├── components/           # React UI components
│   │   ├── chat/             # Chat input & model selector
│   │   ├── message/          # Message display components
│   │   │   ├── MessageList.js
│   │   │   └── ...
│   └── ChatApp.js            # Root application component
├── lib/
│   ├── client/               # Client-side utilities
│   │   ├── chat/             # Chat actions & runtime
│   │   └── hooks/            # React hooks (theme, settings)
│   ├── server/               # Server-side logic
│   │   ├── chat/             # Provider adapters, config, prompts
│   │   ├── webBrowsing/      # Web search & crawl engine
│   │   ├── storage/          # Mounted-disk storage service
│   │   └── conversations/    # Conversation storage logic
│   └── shared/               # Shared constants & types
│       ├── models.js         # Model definitions & capabilities
│       ├── attachments.js    # File type handling
│       └── webSearch.js      # Search configuration
├── models/                   # Mongoose schemas
│   ├── User.js
│   ├── Conversation.js
│   └── StoredFile.js
└── public/                   # Static assets
```

<br/>

---

<br/>

## Tech Stack

<table>
<tr>
<td align="center" width="96"><img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/nextjs/nextjs-original.svg" width="48" height="48" alt="Next.js"/><br/><sub><b>Next.js 16</b></sub></td>
<td align="center" width="96"><img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/react/react-original.svg" width="48" height="48" alt="React"/><br/><sub><b>React 19</b></sub></td>
<td align="center" width="96"><img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/tailwindcss/tailwindcss-original.svg" width="48" height="48" alt="Tailwind"/><br/><sub><b>Tailwind CSS</b></sub></td>
<td align="center" width="96"><img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/mongodb/mongodb-original.svg" width="48" height="48" alt="MongoDB"/><br/><sub><b>MongoDB</b></sub></td>
<td align="center" width="96"><img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/nodejs/nodejs-original.svg" width="48" height="48" alt="Node.js"/><br/><sub><b>Node.js</b></sub></td>
</tr>
</table>

| Layer | Technologies |
|:---|:---|
| **Frontend** | Next.js 16 · React 19 · Tailwind CSS · Framer Motion · Ant Design · Lucide Icons |
| **Backend** | Next.js API Routes · Node.js · SSE (Server-Sent Events) Streaming |
| **Database** | MongoDB with Mongoose ODM |
| **Storage** | Zeabur mounted disk (private media files) |
| **AI Providers** | OpenRouter · Alibaba Cloud Model Studio |
| **Auth** | MongoDB server sessions · bcryptjs |
| **Rendering** | react-markdown · rehype-highlight · rehype-katex · remark-gfm · remark-math |
| **Deployment** | Zeabur native Next.js service (single instance) |

<br/>

---

<br/>

## Getting Started

### Prerequisites

- **Zeabur** project connected to the Git repository
- **MongoDB** instance
- API keys for at least one AI provider

### Deploy on Zeabur

1. Create a service from the Git repository with **Deploy your source code**. Zeabur will automatically recognize the Next.js project and run its npm build/start scripts.
2. Create a persistent volume named `vectaix-data` and mount it at `/data`.
3. Set the HTTP port to `3000` and the health check path to `/api/health`.
4. Add the environment variables below, then redeploy.

### Environment Variables

| Variable | Required | Description |
|:---|:---:|:---|
| `MONGO_URI` | ✅ | MongoDB connection string |
| `STORAGE_ROOT` | ✅ | Mounted disk directory, use `/data/vectaix` on Zeabur |
| `ADMIN_EMAILS` | — | Comma-separated administrator email addresses |
| `OPENROUTER_API_KEY` | — | Shared OpenRouter API key for the GPT, Grok, Claude, Gemini, and Kimi K3 chat models |
| `DASHSCOPE_SINGAPORE_API_KEY` | — | Singapore-region Alibaba Cloud Model Studio API key for Qwen 3.8 Max 0902, Qwen Image 3.0 Pro, HappyHorse video, and Qwen Audio 3.0 TTS Plus |
| `DASHSCOPE_BEIJING_API_KEY` | — | Beijing-region Alibaba Cloud Model Studio API key for MiniMax Speech 2.8 HD / Turbo |
| `AI_MEDIAKIT_API_KEY` | — | API key for AI MediaKit video enhancement (large-model edition); configure when enabled |
| `PUBLIC_APP_URL` | — | Public HTTPS address of the deployed app; required for passkey login and for HappyHorse and MiniMax voice cloning to read input media |
| `APP_SECRETS_KEY` | — | Encrypts external connection credentials, browser login state, and scheduled backup passwords; required when using these features. Use a Base64-encoded 32-byte random key and keep it safe |
| `TINYFISH_API_KEY` | — | Shared API key for free TinyFish Search and Fetch; required when web browsing is enabled |

> [!TIP]
> Configure the key for every model or feature you enable. Missing keys return a clear configuration error.

When updating web browsing, configure `TINYFISH_API_KEY` in Zeabur and remove the previous web service key before replacing the old instance. Startup removes the old web rates from the database while preserving historical bills. Do not keep the old version serving traffic after this migration.

<br/>

---

<br/>

## License

This project is licensed under the [MIT License](LICENSE).

<br/>

---

<div align="center">

<br/>

### ⭐ Star History

<a href="https://star-history.com/#Noah-Wu66/Vectaix-AI&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date" width="600" />
  </picture>
</a>

<br/><br/>

**If you find Vectaix AI useful, please consider giving it a ⭐**

[![GitHub Stars](https://img.shields.io/github/stars/Noah-Wu66/Vectaix-AI?style=for-the-badge&logo=github&logoColor=white&label=Stars&color=fbbf24)](https://github.com/Noah-Wu66/Vectaix-AI/stargazers)
&nbsp;
[![GitHub Forks](https://img.shields.io/github/forks/Noah-Wu66/Vectaix-AI?style=for-the-badge&logo=github&logoColor=white&label=Forks&color=60a5fa)](https://github.com/Noah-Wu66/Vectaix-AI/network/members)

<br/>

<br/>

</div>
