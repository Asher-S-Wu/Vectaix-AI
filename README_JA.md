<div align="center">

<br/>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/%E2%9C%A6%20VECTAIX%20AI-%E6%AC%A1%E4%B8%96%E4%BB%A3AI-8B5CF6?style=for-the-badge&labelColor=1e1b4b">
  <img src="https://img.shields.io/badge/%E2%9C%A6%20VECTAIX%20AI-%E6%AC%A1%E4%B8%96%E4%BB%A3AI-8B5CF6?style=for-the-badge&labelColor=1e1b4b" alt="Vectaix AI" width="420"/>
</picture>

<br/><br/>

**マルチモデルAIチャットプラットフォーム · Fusion Modeによる合意駆動型インテリジェンス**

<br/>

[![Next.js 16](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=next.js&logoColor=white)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=flat-square&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![Vercel](https://img.shields.io/badge/Vercel-000000?style=flat-square&logo=vercel&logoColor=white)](https://vercel.com/)
[![License: MIT](https://img.shields.io/badge/ライセンス-MIT-22c55e?style=flat-square)](LICENSE)

<br/>

[**English**](README.md)&nbsp;&nbsp;|&nbsp;&nbsp;[**简体中文**](README_ZH.md)&nbsp;&nbsp;|&nbsp;&nbsp;[**日本語**](README_JA.md)

<br/>

<table>
<tr>
<td align="center" width="150"><img src="https://img.shields.io/badge/-GPT--5.5-412991?style=for-the-badge&logo=openai&logoColor=white" alt="GPT-5.5"/><br/><sub><b>OpenAI</b></sub></td>
<td align="center" width="150"><img src="https://img.shields.io/badge/-Claude%20Opus%204.8-D97757?style=for-the-badge&logo=anthropic&logoColor=white" alt="Claude"/><br/><sub><b>Anthropic</b></sub></td>
<td align="center" width="150"><img src="https://img.shields.io/badge/-Gemini%203.5%20Flash-4285F4?style=for-the-badge&logo=google&logoColor=white" alt="Gemini"/><br/><sub><b>Google</b></sub></td>
<td align="center" width="150"><img src="https://img.shields.io/badge/-Doubao%20Seed%202.1-FF6A00?style=for-the-badge&logoColor=white" alt="Doubao"/><br/><sub><b>ByteDance</b></sub></td>
</tr>
<tr>
<td align="center" width="150"><img src="https://img.shields.io/badge/-OpenRouter%20Fusion-111827?style=for-the-badge&logoColor=white" alt="OpenRouter Fusion"/><br/><sub><b>OpenRouter</b></sub></td>
<td align="center" width="150"><img src="https://img.shields.io/badge/-GPT%20Image%202-412991?style=for-the-badge&logo=openai&logoColor=white" alt="GPT Image 2"/><br/><sub><b>OpenAI</b></sub></td>
<td align="center" width="150"><img src="https://img.shields.io/badge/-Seedance%202.0-FF6A00?style=for-the-badge&logoColor=white" alt="Seedance"/><br/><sub><b>ByteDance</b></sub></td>
</tr>
</table>

</div>

<br/>

---

<br/>

## 概要

**Vectaix AI** は、世界最先端の言語モデルを統一インターフェースに集約した、プロダクショングレードのマルチモデルAIチャットプラットフォームです。単一のAIプロバイダーに縛られることなく、複数のフロンティアモデル間を自由に切り替え、さらには組み合わせて使用できます。

中核となる **Fusion Mode** は、クエリを複数のフロンティアLLMに並列分配し、構造化された討議を通じてそれらの出力を統合する新しいマルチエージェント合意フレームワークです。これにより、ハルシネーションとバイアスが大幅に低減されます。

<br/>

---

<br/>

## 機能

### 🤖 マルチモデルインテリジェンス

4つの直接チャットモデルとFusion Modeに、統一インターフェースでアクセス。会話中にモデルを切り替えても、コンテキストは完全に保持されます。

| モデル | プロバイダー | コンテキスト | 入力タイプ | 思考 | ウェブ検索 |
|:---:|:---:|:---:|:---:|:---:|:---:|
| **Fusion** | OpenRouter | — | テキスト | — | — |
| **GPT 5.5** | OpenAI | 256K | テキスト、画像、ファイル | ✅ | ✅ |
| **Claude Opus 4.8** | Anthropic | 200K | テキスト、画像、ファイル | ✅ | ✅ |
| **Gemini 3.5 Flash** | Google | 1M | テキスト、画像、ファイル | ✅ | ✅ |
| **Doubao Seed 2.1 Pro** | ByteDance | 128K | テキスト、画像、ファイル | ✅ | ✅ |

専用メディアモデル：

| モデル | プロバイダー | 機能 |
|:---:|:---:|:---|
| **GPT Image 2** | OpenAI | 画像生成と画像編集 |
| **Seedance 2.0 Standard** | ByteDance | テキストから動画、画像から動画 |

<br/>

### 🏛️ Fusion Mode — マルチエージェント合意

Vectaix AIの最大の特徴です。複数のAIエキスパートを協調させて、より真実かつバランスの取れた回答を導き出します。

```
                              ┌─────────────────┐
                              │   ユーザークエリ   │
                              └────────┬─────────┘
                                       │
                          ┌────────────┼────────────┐
                          ▼            ▼            ▼
                   ┌────────────┐┌────────────┐┌────────────┐
                   │  GPT 5.5   ││Claude Opus ││Gemini 3.5  │
                   │（エキスパート）││4.8(エキスパート)││Flash(エキスパート)│
                   └─────┬──────┘└─────┬──────┘└─────┬──────┘
                         │             │             │
                         └─────────────┼─────────────┘
                                       ▼
                              ┌─────────────────┐
                              │OpenRouter Fusion│
                              │  （統合分析）     │
                              └────────┬─────────┘
                                       │
                         ┌─────────────┼─────────────┐
                         ▼             ▼             ▼
                   ┌──────────┐ ┌──────────┐ ┌──────────┐
                   │ 合意点    │ │ 主な相違  │ │ 独自の    │
                   │          │ │          │ │ 知見     │
                   └──────────┘ └──────────┘ └──────────┘
```

**仕組み：**

1. **並列生成** — クエリは GPT 5.5、Claude Opus 4.8、Gemini 3.5 Flash に同時送信
2. **独立推論** — 各エキスパートがそれぞれの強みと知識で独立して推論
3. **構造化統合** — OpenRouter Fusion が全回答を分析し、以下を特定：
   - ✅ **合意点** — 全エキスパートが一致する見解
   - ⚖️ **主な相違** — エキスパート間の意見の相違とその理由
   - 💡 **独自の知見** — 個々のエキスパートからの価値ある視点
   - 🔍 **盲点の発見** — クロスモデル分析でのみ明らかになるギャップ

> Fusion Mode の現在のバージョンはウェブ検索に非対応で、マルチモデルのテキスト推論に特化しています。

**論文の主要成果：**

| ベンチマーク | 改善 |
|:---|:---:|
| HaluEval（ハルシネーション検出） | **相対35.9%削減** |
| TruthfulQA | **最良単一モデルを+7.8ポイント上回る** |
| ドメイン間バイアス分散 | **大幅に低下** |

<br/>

### 🌐 ウェブブラウジング＆検索

インテリジェントなマルチラウンドブラウジング機能によるリアルタイムインターネットアクセス。

- **スマート検索** — AI駆動のクエリ最適化で最適な検索結果を取得
- **ページクローリング** — ページコンテンツの深層抽出と分析
- **マルチページブラウジング** — 1セッションで複数ページをクロール
- **インライン引用** — すべての主張にトレーサブルなソース参照を付与

<br/>

### 📎 リッチなファイル理解

会話中に直接、多様なファイルタイプをアップロード・分析できます。

| ファイルタイプ | 対応フォーマット | 機能 |
|:---|:---|:---|
| 🖼️ **画像** | PNG, JPG, GIF, WebP | 視覚分析、OCR、説明生成 |
| 📄 **PDF** | PDF | テキスト抽出、分析、Q&A |
| 📝 **Word** | DOCX, DOC | ドキュメント全体の解析 |
| 📊 **スプレッドシート** | XLSX, XLS | データ分析、テーブル理解 |

<br/>

### 🖥️ コードサンドボックス

**Vercel Sandbox** による安全で隔離された環境でコードを実行。

- **安全な実行** — ネットワークポリシー付きのサンドボックスランタイム
- **リアルタイム出力** — コード実行中のstdout/stderrをストリーミング
- **ファイル操作** — サンドボックス内でのファイル読み書き
- **多言語対応** — Pythonなど

<br/>

### ✨ 洗練されたユーザー体験

<table>
<tr>
<td width="50%">

**💬 会話管理**
- MongoDBベースの永続的チャット履歴
- インテリジェントな長会話圧縮
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
- JWTベースのセッション管理
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
│   │   ├── fusion/           # Fusion Modeオーケストレーション
│   │   ├── chat/             # ZenMux チャットと圧縮
│   │   ├── auth/             # 認証エンドポイント
│   │   ├── conversations/    # 会話CRUD
│   │   ├── media/            # 画像/動画生成
│   │   ├── upload/           # Blobファイルアップロード
│   │   └── admin/            # 管理機能
│   ├── components/           # React UIコンポーネント
│   │   ├── chat/             # チャット入力とモデル選択
│   │   ├── message/          # メッセージ表示コンポーネント
│   │   │   ├── FusionMessage.js # Fusion Mode結果レンダリング
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
│   │   ├── sandbox/          # Vercel Sandbox統合
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
<td align="center" width="96"><img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/vercel/vercel-original.svg" width="48" height="48" alt="Vercel"/><br/><sub><b>Vercel</b></sub></td>
</tr>
</table>

| レイヤー | 技術 |
|:---|:---|
| **フロントエンド** | Next.js 16 · React 19 · Tailwind CSS · Framer Motion · Ant Design · Lucide Icons |
| **バックエンド** | Next.js API Routes · Node.js · SSE（Server-Sent Events）ストリーミング |
| **データベース** | MongoDB + Mongoose ODM |
| **ストレージ** | Vercel Blob（ファイルアップロード＆添付） |
| **AIプロバイダー** | ZenMux OpenAI互換ルーティング · OpenRouter · Volcengine Ark |
| **コード実行** | Vercel Sandbox（隔離ランタイム） |
| **認証** | JWT (jose) · bcryptjs |
| **レンダリング** | react-markdown · rehype-highlight · rehype-katex · remark-gfm · remark-math |
| **ファイル解析** | pdf-parse · mammoth (DOCX) · word-extractor (DOC) · xlsx |
| **デプロイ** | Vercel (Pro) |

<br/>

---

<br/>

## はじめに

### 前提条件

- **Node.js** 18+
- **MongoDB** インスタンス（ローカルまたはAtlas）
- 少なくとも1つのAIプロバイダーのAPIキー

### インストール

```bash
# リポジトリをクローン
git clone https://github.com/Noah-Wu66/Vectaix-AI.git

# プロジェクトディレクトリに移動
cd Vectaix-AI

# 依存関係をインストール
npm install

# 開発サーバーを起動
npm run dev
```

### 環境変数

| 変数 | 必須 | 説明 |
|:---|:---:|:---|
| `MONGODB_URI` | ✅ | MongoDB接続文字列 |
| `JWT_SECRET` | ✅ | JWTトークン署名シークレット |
| `ZENMUX_API_KEY` | — | GPT、Claude、Gemini、画像生成用のZenMux APIキー |
| `OPENROUTER_API_KEY` | — | Fusion統合モデル用のOpenRouter APIキー |
| `ARK_API_KEY` | — | Doubao SeedとSeedance動画用のVolcengine Ark APIキー |
| `BLOB_READ_WRITE_TOKEN` | — | Vercel Blobストレージトークン |

> [!TIP]
> 使用したいプロバイダーのAPIキーのみ設定すればOKです。プラットフォームは不足しているプロバイダー設定を適切に処理します。

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

<sub>知性で構築し、合意で駆動する。</sub>

<br/>

</div>
