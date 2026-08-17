<div align="center">

<br/>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/%E2%9C%A6%20VECTAIX%20AI-%E6%AC%A1%E4%B8%96%E4%BB%A3AI-8B5CF6?style=for-the-badge&labelColor=1e1b4b">
  <img src="https://img.shields.io/badge/%E2%9C%A6%20VECTAIX%20AI-%E6%AC%A1%E4%B8%96%E4%BB%A3AI-8B5CF6?style=for-the-badge&labelColor=1e1b4b" alt="Vectaix AI" width="420"/>
</picture>

<br/><br/>

**会話・ウェブ検索・メディア制作のためのマルチモデルAIチャットプラットフォーム**

<br/>

[![Next.js 16](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=next.js&logoColor=white)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=flat-square&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![Zeabur](https://img.shields.io/badge/Zeabur-6300FF?style=flat-square)](https://zeabur.com/)
[![License: MIT](https://img.shields.io/badge/ライセンス-MIT-22c55e?style=flat-square)](LICENSE)

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
<td align="center" width="150"><img src="https://img.shields.io/badge/-Qwen%20Image%203.0%20Pro-615CED?style=for-the-badge&logoColor=white" alt="Qwen Image 3.0 Pro"/><br/><sub><b>Alibaba Cloud</b></sub></td>
<td align="center" width="150"><img src="https://img.shields.io/badge/-HappyHorse-615CED?style=for-the-badge&logoColor=white" alt="HappyHorse"/><br/><sub><b>Alibaba Cloud</b></sub></td>
<td align="center" width="150"><img src="https://img.shields.io/badge/-Kimi%20K3-2563EB?style=for-the-badge&logoColor=white" alt="Kimi K3"/><br/><sub><b>Moonshot AI</b></sub></td>
<td align="center" width="150"><img src="https://img.shields.io/badge/-Qwen%203.8%20Max-615CED?style=for-the-badge&logoColor=white" alt="Qwen 3.8 Max"/><br/><sub><b>Alibaba Cloud</b></sub></td>
</tr>
</table>

</div>

<br/>

---

<br/>

## 概要

**Vectaix AI** は、世界をリードする言語モデルを統一インターフェースに集約した、プロダクショングレードのマルチモデルAIチャットプラットフォームです。単一のAIプロバイダーに縛られることなく、複数のフロンティアモデル間を自由に切り替えられます。

<br/>

---

<br/>

## 機能

### 🤖 マルチモデルインテリジェンス

7つのチャットモデルに統一インターフェースでアクセスできます。モデルを切り替えると新しいトピックが開始され、各モデルのコンテキストが独立して保たれます。

| モデル | プロバイダー | コンテキスト | 入力タイプ | 思考 | ウェブ検索 |
|:---:|:---:|:---:|:---:|:---:|:---:|
| **GPT-5.6 Sol** | OpenAI | 1.05M | テキスト、画像 | ✅ | ✅ |
| **Claude Opus 5** | Anthropic | 1M | テキスト、画像 | ✅ | ✅ |
| **Gemini 3.7 Flash** | Google | 1M | テキスト、画像、音声、動画 | ✅ | ✅ |
| **Abliterated Model Large** | Abliteration AI | 1M | テキスト | ✅ | ✅ |
| **Grok 4.5** | xAI | 500K | テキスト、画像 | ✅ | ✅ |
| **Kimi K3** | Moonshot AI | 1M | テキスト、画像 | ✅ | ✅ |
| **Qwen 3.8 Max** | Alibaba Cloud | 1M | テキスト、画像 | ✅ | ✅ |

専用メディアモデル：

| モデル | プロバイダー | 機能 |
|:---:|:---:|:---|
| **Qwen Image 3.0 Pro** | Alibaba Cloud | 画像生成と1～3枚の参照画像を使った画像編集 |
| **HappyHorse 1.1 / Video Edit 1.0** | Alibaba Cloud | テキストから動画、先頭フレームから動画、複数参照画像から動画、動画編集 |
| **Doubao Audio Generation 1.0** | Volcengine | テキストまたは参照音声から最長120秒のナレーション、効果音、環境音を生成 |
| **Qwen Audio 3.0 TTS Plus** | Alibaba Cloud | 多言語音声合成、表現制御、音声クローン |
| **MiniMax Speech 2.8 HD / Turbo** | Alibaba Cloud | 感情音声合成、システム音声、ユーザー専用音声クローン |

<br/>

### 🌐 ウェブブラウジング＆検索

インテリジェントなマルチラウンドブラウジング機能によるリアルタイムインターネットアクセス。

- **スマート検索** — Firecrawl Search で最新かつ関連性の高い情報源を発見
- **ページクローリング** — Firecrawl Scrape で選択したページをクリーンな Markdown として抽出
- **マルチページブラウジング** — 1セッションで複数ページをクロール
- **インライン引用** — すべての主張にトレーサブルなソース参照を付与

<br/>

### 📎 プライベートマルチメディア

Zeabur のマウントディスクに保存したプライベートメディアを分析できます。

| ファイルタイプ | 対応フォーマット | 機能 |
|:---|:---|:---|
| 🖼️ **画像** | PNG, JPG, GIF, WebP | 視覚分析、OCR、説明生成 |
| 🎵 **音声** | MP3、WAV、M4A、AAC、OGG | Gemini 音声理解 |
| 🎬 **動画** | MP4、MOV、WebM、M4V | Gemini 動画理解 |

<br/>

### ✨ 洗練されたユーザー体験

<table>
<tr>
<td width="50%">

**💬 会話管理**
- MongoDBベースの永続的チャット履歴
- 重要な会話のピン留め
- 会話単位のモデル・設定管理

</td>
<td width="50%">

**🎨 テーマ＆カスタマイズ**
- ダーク / ライトモード（スムーズトランジション）
- フォントサイズ調整
- 完了サウンド＆ボリューム制御
- カスタムユーザーアバター

</td>
</tr>
<tr>
<td width="50%">

**📝 リッチMarkdownレンダリング**
- GitHub Flavored Markdown (GFM) 完全対応
- LaTeX数式（KaTeX）
- シンタックスハイライト付きコードブロック
- スクロール可能なテーブル（コピー機能付き）

</td>
<td width="50%">

**🔐 認証＆セキュリティ**
- MongoDBベースのサーバーセッション管理
- Bcryptパスワードハッシュ
- 全エンドポイントのレート制限
- 管理者ユーザー管理パネル

</td>
</tr>
<tr>
<td width="50%">

**⚙️ 高度なコントロール**
- モデルごとの思考レベル調整
- 最大トークン数制御
- カスタムシステムプロンプト（プリセット対応）
- メディア解像度設定

</td>
<td width="50%">

**📱 プログレッシブWebアプリ**
- あらゆるデバイスにインストール可能
- モバイル最適化レスポンシブUI
- タッチフレンドリーなインターフェース
- オフライン対応マニフェスト

</td>
</tr>
</table>

<br/>

---

<br/>

## アーキテクチャ

```
vectaix-ai/
├── app/
│   ├── api/
│   │   ├── chat/             # マルチプロバイダーチャット
│   │   ├── auth/             # 認証エンドポイント
│   │   ├── conversations/    # 会話CRUD
│   │   ├── media/            # 画像/動画生成
│   │   ├── upload/           # プライベートディスクアップロード
│   │   └── admin/            # 管理機能
│   ├── components/           # React UIコンポーネント
│   │   ├── chat/             # チャット入力とモデル選択
│   │   ├── message/          # メッセージ表示コンポーネント
│   │   │   ├── MessageList.js
│   │   │   └── ...
│   └── ChatApp.js            # ルートアプリケーションコンポーネント
├── lib/
│   ├── client/               # クライアントサイドユーティリティ
│   │   ├── chat/             # チャットアクション＆ランタイム
│   │   └── hooks/            # React Hooks（テーマ、設定）
│   ├── server/               # サーバーサイドロジック
│   │   ├── chat/             # プロバイダーアダプター、設定、プロンプト
│   │   ├── webBrowsing/      # ウェブ検索＆クロールエンジン
│   │   ├── storage/          # マウントディスクストレージ
│   │   └── conversations/    # 会話ストレージロジック
│   └── shared/               # 共有定数＆型定義
│       ├── models.js         # モデル定義＆機能
│       ├── attachments.js    # ファイルタイプ処理
│       └── webSearch.js      # 検索設定
├── models/                   # Mongooseスキーマ
│   ├── User.js
│   └── Conversation.js
└── public/                   # 静的アセット
```

<br/>

---

<br/>

## 技術スタック

<table>
<tr>
<td align="center" width="96"><img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/nextjs/nextjs-original.svg" width="48" height="48" alt="Next.js"/><br/><sub><b>Next.js 16</b></sub></td>
<td align="center" width="96"><img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/react/react-original.svg" width="48" height="48" alt="React"/><br/><sub><b>React 19</b></sub></td>
<td align="center" width="96"><img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/tailwindcss/tailwindcss-original.svg" width="48" height="48" alt="Tailwind"/><br/><sub><b>Tailwind CSS</b></sub></td>
<td align="center" width="96"><img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/mongodb/mongodb-original.svg" width="48" height="48" alt="MongoDB"/><br/><sub><b>MongoDB</b></sub></td>
<td align="center" width="96"><img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/nodejs/nodejs-original.svg" width="48" height="48" alt="Node.js"/><br/><sub><b>Node.js</b></sub></td>
</tr>
</table>

| レイヤー | 技術 |
|:---|:---|
| **フロントエンド** | Next.js 16 · React 19 · Tailwind CSS · Framer Motion · Ant Design · Lucide Icons |
| **バックエンド** | Next.js API Routes · Node.js · SSE（Server-Sent Events）ストリーミング |
| **データベース** | MongoDB + Mongoose ODM |
| **ストレージ** | Zeabur マウントディスク（プライベートメディア） |
| **AIプロバイダー** | OpenRouter · Abliteration · Alibaba Cloud Model Studio |
| **認証** | MongoDBサーバーセッション · bcryptjs |
| **レンダリング** | react-markdown · rehype-highlight · rehype-katex · remark-gfm · remark-math |
| **デプロイ** | Zeabur ネイティブ Next.js サービス（単一インスタンス） |

<br/>

---

<br/>

## はじめに

### 前提条件

- Gitリポジトリに接続した **Zeabur** プロジェクト
- **MongoDB** インスタンス
- 少なくとも1つのAIプロバイダーのAPIキー

### Zeabur へのデプロイ

1. Zeabur で「ソースコードをデプロイ」を選び、Gitリポジトリをインポートします。Next.js は自動認識され、npm のビルド／起動コマンドが実行されます。
2. `vectaix-data` という永続ボリュームを作成し、`/data` にマウントします。
3. HTTPポートを `3000`、ヘルスチェックを `/api/health` に設定します。
4. 以下の環境変数を追加して再デプロイします。

### 環境変数

| 変数 | 必須 | 説明 |
|:---|:---:|:---|
| `MONGO_URI` | ✅ | MongoDB接続文字列 |
| `STORAGE_ROOT` | ✅ | マウントディスクのパス。Zeabur では `/data/vectaix` |
| `ADMIN_EMAILS` | — | カンマ区切りの管理者メールアドレス |
| `OPENROUTER_API_KEY` | — | GPT、Grok、Claude、Gemini、Kimi K3の各チャットモデルで共用するOpenRouter APIキー |
| `ABLIT_KEY` | — | Abliterated Model Large 用の Abliteration APIキー（`ak_...`） |
| `DASHSCOPE_SINGAPORE_API_KEY` | — | Qwen 3.8 Max、Qwen Image 3.0 Pro、HappyHorse動画、Qwen Audio 3.0 TTS Plus 用のシンガポール地域Alibaba Cloud Model Studio APIキー |
| `DASHSCOPE_BEIJING_API_KEY` | — | MiniMax Speech 2.8 HD / Turbo 用の北京地域Alibaba Cloud Model Studio APIキー |
| `DOUBAO_AUDIO_API_KEY` | — | Doubao Audio Generation 1.0 用のVolcengine新版コンソールAPIキー |
| `PUBLIC_APP_URL` | — | HappyHorseとMiniMax音声クローンが入力素材を読み取るために使う、デプロイ済みアプリの公開HTTPSアドレス |
| `FIRECRAWL_API_KEY` | — | Firecrawl Search と Scrape 用のAPIキー |

> [!TIP]
> 有効にするモデルや機能ごとに対応するキーを設定してください。キーがない場合は明確な設定エラーを返します。

<br/>

---

<br/>

## ライセンス

本プロジェクトは [MITライセンス](LICENSE) の下で公開されています。

<br/>

---

<div align="center">

<br/>

### ⭐ Star 推移

<a href="https://star-history.com/#Noah-Wu66/Vectaix-AI&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date" width="600" />
  </picture>
</a>

<br/><br/>

**Vectaix AIが役に立ったら、ぜひ ⭐ をお願いします！**

[![GitHub Stars](https://img.shields.io/github/stars/Noah-Wu66/Vectaix-AI?style=for-the-badge&logo=github&logoColor=white&label=Stars&color=fbbf24)](https://github.com/Noah-Wu66/Vectaix-AI/stargazers)
&nbsp;
[![GitHub Forks](https://img.shields.io/github/forks/Noah-Wu66/Vectaix-AI?style=for-the-badge&logo=github&logoColor=white&label=Forks&color=60a5fa)](https://github.com/Noah-Wu66/Vectaix-AI/network/members)

<br/>

<sub>知性で構築し、創造の自由を広げる。</sub>

<br/>

</div>
