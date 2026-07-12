<div align="center">

<br/>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/%E2%9C%A6%20VECTAIX%20AI-Next%20Gen%20Intelligence-8B5CF6?style=for-the-badge&labelColor=1e1b4b">
  <img src="https://img.shields.io/badge/%E2%9C%A6%20VECTAIX%20AI-Next%20Gen%20Intelligence-8B5CF6?style=for-the-badge&labelColor=1e1b4b" alt="Vectaix AI" width="420"/>
</picture>

<br/><br/>

**Multi-Model AI Chat Platform with Fusion Mode for Consensus-Driven Intelligence**

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
<td align="center" width="150"><img src="https://img.shields.io/badge/-GPT--5.6%20Sol-412991?style=for-the-badge&logo=openai&logoColor=white" alt="GPT-5.6 Sol"/><br/><sub><b>OpenAI</b></sub></td>
<td align="center" width="150"><img src="https://img.shields.io/badge/-Claude%20Opus%204.8-D97757?style=for-the-badge&logo=anthropic&logoColor=white" alt="Claude"/><br/><sub><b>Anthropic</b></sub></td>
<td align="center" width="150"><img src="https://img.shields.io/badge/-Gemini%203.5%20Flash-4285F4?style=for-the-badge&logo=google&logoColor=white" alt="Gemini"/><br/><sub><b>Google</b></sub></td>
<td align="center" width="150"><img src="https://img.shields.io/badge/-Grok%204.5-111111?style=for-the-badge&logo=x&logoColor=white" alt="Grok 4.5"/><br/><sub><b>xAI</b></sub></td>
</tr>
<tr>
<td align="center" width="150"><img src="https://img.shields.io/badge/-OpenRouter%20Fusion-111827?style=for-the-badge&logoColor=white" alt="OpenRouter Fusion"/><br/><sub><b>OpenRouter</b></sub></td>
<td align="center" width="150"><img src="https://img.shields.io/badge/-GPT%20Image%202-412991?style=for-the-badge&logo=openai&logoColor=white" alt="GPT Image 2"/><br/><sub><b>OpenAI</b></sub></td>
<td align="center" width="150"><img src="https://img.shields.io/badge/-Seedance%202.0-FF6A00?style=for-the-badge&logoColor=white" alt="Seedance"/><br/><sub><b>ByteDance</b></sub></td>
<td align="center" width="150"><img src="https://img.shields.io/badge/-GLM--5.2-315EFB?style=for-the-badge&logoColor=white" alt="GLM-5.2"/><br/><sub><b>Z.AI</b></sub></td>
</tr>
</table>

</div>

<br/>

---

<br/>

## Overview

**Vectaix AI** is a production-grade, multi-model AI chat platform that unifies the world's most powerful language models under a single, elegant interface. Rather than locking users into one AI provider, Vectaix gives you the freedom to switch between — or even combine — frontier models seamlessly.

At its core is **Fusion Mode**, a novel multi-agent consensus framework that dispatches queries to multiple frontier LLMs in parallel and synthesizes their outputs through structured deliberation — dramatically reducing hallucination and bias.

<br/>

---

<br/>

## Features

### 🤖 Multi-Model Intelligence

Access 5 direct chat models plus Fusion Mode through a unified interface. Switch models mid-conversation with full context preservation.

| Model | Provider | Context Window | Inputs | Thinking | Web Search |
|:---:|:---:|:---:|:---:|:---:|:---:|
| **Fusion** | OpenRouter | — | Text | — | — |
| **GPT-5.6 Sol** | OpenAI | 1.05M | Text, Image | ✅ | ✅ |
| **Claude Opus 4.8** | Anthropic | 1M | Text, Image | ✅ | ✅ |
| **Gemini 3.5 Flash** | Google | 1M | Text, Image, Audio, Video | ✅ | ✅ |
| **Grok 4.5** | xAI | 500K | Text, Image | ✅ | ✅ |
| **GLM-5.2** | Z.AI | 1M | Text, Image | ✅ | ✅ |

Dedicated media models:

| Model | Provider | Capability |
|:---:|:---:|:---|
| **GPT Image 2** | OpenAI | Image generation and image editing |
| **Seedance 2.0 Standard** | ByteDance | Text-to-video and image-to-video |

<br/>

### 🏛️ Fusion Mode — Multi-Agent Consensus

The crown jewel of Vectaix AI. Inspired by the deliberative processes of real-world councils, this mode orchestrates multiple AI experts to arrive at a more truthful, balanced answer.

```
                              ┌─────────────────┐
                              │   User Query     │
                              └────────┬─────────┘
                                       │
                          ┌────────────┼────────────┐
                          ▼            ▼            ▼
                   ┌────────────┐┌────────────┐┌────────────┐
                   │    GPT     ││   Claude   ││   Gemini   │
                   │    5.5     ││  Opus 4.8  ││ 3.5 Flash  │
                   │  (Expert)  ││  (Expert)  ││  (Expert)  │
                   └─────┬──────┘└─────┬──────┘└─────┬──────┘
                         │             │             │
                         └─────────────┼─────────────┘
                                       ▼
                              ┌─────────────────┐
                              │OpenRouter Fusion│
                              │  (Synthesis)    │
                              └────────┬─────────┘
                                       │
                         ┌─────────────┼─────────────┐
                         ▼             ▼             ▼
                   ┌──────────┐ ┌──────────┐ ┌──────────┐
                   │Agreement │ │Key Diffs │ │ Unique   │
                   │  Points  │ │& Debates │ │ Insights │
                   └──────────┘ └──────────┘ └──────────┘
```

**How it works:**

1. **Parallel Generation** — Your query is simultaneously sent to GPT-5.6 Sol, Claude Opus 4.8, and Gemini 3.5 Flash
2. **Independent Reasoning** — Each expert reasons independently with its own strengths and knowledge
3. **Structured Synthesis** — OpenRouter Fusion analyzes all responses, identifying:
   - ✅ **Agreement** — Points where all experts converge
   - ⚖️ **Key Differences** — Where experts disagree and why
   - 💡 **Unique Insights** — Valuable perspectives from individual experts
   - 🔍 **Blind Spots** — Gaps that only cross-model analysis reveals

> Fusion Mode currently does not support web search; it focuses on text-only multi-model reasoning.

**Key Results from Research:**

| Benchmark | Improvement |
|:---|:---:|
| HaluEval (Hallucination Detection) | **35.9% relative reduction** |
| TruthfulQA | **+7.8 points over best individual model** |
| Cross-domain Bias Variance | **Significantly lower** |

<br/>

### 🌐 Web Browsing & Search

Real-time access to the internet with intelligent multi-round browsing capabilities.

- **Smart Search** — Discover fresh, relevant sources with Firecrawl Search
- **Page Crawling** — Extract selected pages as clean Markdown with Firecrawl Scrape
- **Multi-Page Browsing** — Crawl multiple pages in a single session
- **Inline Citations** — Every claim backed by traceable source references

<br/>

### 📎 Private Multimodal Files

Upload private media files stored on the Zeabur mounted disk.

| File Type | Supported Formats | Capability |
|:---|:---|:---|
| 🖼️ **Images** | PNG, JPG, GIF, WebP | Visual analysis, OCR, description |
| 🎵 **Audio** | MP3, WAV, M4A, AAC, OGG | Gemini audio understanding |
| 🎬 **Video** | MP4, MOV, WebM, M4V | Gemini video understanding |

<br/>

### ✨ Polished User Experience

<table>
<tr>
<td width="50%">

**💬 Conversation Management**
- Persistent chat history with MongoDB
- Intelligent long-conversation compression
- Pin important conversations
- Conversation-specific model & settings

</td>
<td width="50%">

**🎨 Themes & Customization**
- Dark / Light mode with smooth transitions
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
- Rate limiting on all endpoints
- Admin user management panel

</td>
</tr>
<tr>
<td width="50%">

**⚙️ Advanced Controls**
- Per-model thinking level adjustment
- Max tokens control
- Custom system prompts with presets
- Media resolution settings

</td>
<td width="50%">

**📱 Progressive Web App**
- Installable on any device
- Mobile-optimized responsive UI
- Touch-friendly interface
- Offline-capable manifest

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
│   │   ├── fusion/           # Fusion Mode orchestration
│   │   ├── chat/             # Multi-provider chat & compression
│   │   ├── auth/             # Authentication endpoints
│   │   ├── conversations/    # Conversation CRUD
│   │   ├── media/            # Image/video generation
│   │   ├── upload/           # Private disk file upload
│   │   └── admin/            # Admin management
│   ├── components/           # React UI components
│   │   ├── chat/             # Chat input & model selector
│   │   ├── message/          # Message display components
│   │   │   ├── FusionMessage.js # Fusion Mode result rendering
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
| **AI Providers** | Inferera · Google Gemini API · OpenRouter |
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
| `AIHUBMIX_API_KEY` | — | Inferera key for GPT, Grok, Claude, GLM, image, and video APIs |
| `GEMINI_API_KEY` | — | Google Gemini API key for Gemini chat and conversation compression |
| `OPENROUTER_API_KEY` | — | OpenRouter API key for Fusion synthesis |
| `FIRECRAWL_API_KEY` | — | API key for Firecrawl Search and Scrape |

> [!TIP]
> Configure the key for every model or feature you enable. Missing keys return a clear configuration error.

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

<sub>Built with intelligence. Powered by consensus.</sub>

<br/>

</div>
