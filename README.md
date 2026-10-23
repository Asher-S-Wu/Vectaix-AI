<div align="center">

<br/>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/%E2%9C%A6%20VECTAIX%20AI-Chat%20%26%20Media-8B5CF6?style=for-the-badge&labelColor=1e1b4b">
  <img src="https://img.shields.io/badge/%E2%9C%A6%20VECTAIX%20AI-Chat%20%26%20Media-8B5CF6?style=for-the-badge&labelColor=1e1b4b" alt="Vectaix AI" width="420"/>
</picture>

<br/><br/>

**AI Assistant for Conversations, Web Search, and Media Creation**

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

## Features

### 🤖 Vectaix Assistant

Ask questions through a simple message field and send button. Vectaix keeps conversation history, streams replies and thinking, and can read responses aloud. Chat requests use the official DeepSeek API with `deepseek-flash`.

### 🎨 Media Workspace

Generate and edit images, and create speech with Fish Audio S2.1 Pro in the media workspace.

Dedicated media models:

| Model | Provider | Capability |
|:---:|:---:|:---|
| **GPT Image 2.5** | Micu | Image generation and editing with reference images |
| **Fish Audio S2.1 Pro** (`s2.1-pro-free`) | Fish Audio | Multilingual speech using voices cloned by the current user; billed at $0 per million UTF-8 input bytes |

<br/>

### 🌐 Web Browsing & Search

Search the web and read multiple pages to inform answers.

- **Smart Search** — Discover fresh sources with free TinyFish Search in the language of the current question
- **Page Content** — Extract selected pages as clean Markdown with free TinyFish Fetch
- **Multi-Page Browsing** — Crawl multiple pages in a single session
- **Inline Citations** — Answers can include links to supporting sources

Search and page fetching have no additional fee. Model calls used to read sources and generate answers are billed separately.

<br/>

### 📎 Private Media Storage

The media workspace stores uploaded source files and generated images and speech in private storage. Files are available to their owner for preview and download.

<br/>

### ✨ Chat & Personalization

<table>
<tr>
<td width="50%">

**💬 Conversation Management**
- Persistent chat history with MongoDB
- Pin important conversations
- Conversation-specific memory and skill settings

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
│   │   ├── media/            # Image and speech creation
│   │   ├── upload/           # Private disk file upload
│   │   └── admin/            # Admin management
│   ├── components/           # React UI components
│   │   ├── chat/             # Chat input and send action
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
| **Frontend** | Next.js 16 · React 19 · Tailwind CSS · Framer Motion · Lucide Icons |
| **Backend** | Next.js API Routes · Node.js · SSE (Server-Sent Events) Streaming |
| **Database** | MongoDB with Mongoose ODM |
| **Storage** | Zeabur mounted disk (private media files) |
| **AI Providers** | Micu · Alibaba Cloud Model Studio · Volcengine |
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
| `DEEPSEEK_API_KEY` | ✅ | Official DeepSeek API key for the assistant (`deepseek-flash`) |
| `MICU_OPENAI_IMAGE_API_KEY` | — | Micu image service API key |
| `FISH_API_KEY` | — | Official Fish Audio API key; configure to enable S2.1 Pro speech generation |
| `PUBLIC_APP_URL` | — | Public HTTPS address of the deployed app; required for passkey login |
| `APP_SECRETS_KEY` | — | Encrypts external connection credentials, browser login state, and scheduled backup passwords; required when using these features. Use a Base64-encoded 32-byte random key and keep it safe |
| `TINYFISH_API_KEY` | — | Shared API key for free TinyFish Search and Fetch; required when web browsing is enabled |

> [!TIP]
> Configure the assistant key and the keys for the media and web features you use.

<br/>

---

<br/>

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
