<div align="center">

<br/>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/%E2%9C%A6%20VECTAIX%20AI-AI%20Chat-8B5CF6?style=for-the-badge&labelColor=1e1b4b">
  <img src="https://img.shields.io/badge/%E2%9C%A6%20VECTAIX%20AI-AI%20Chat-8B5CF6?style=for-the-badge&labelColor=1e1b4b" alt="Vectaix AI" width="420"/>
</picture>

<br/><br/>

**会話・ウェブ検索・メディア制作のためのAIアシスタント**

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

## 機能

### 🤖 Vectaix アシスタント

入力欄に質問を書き、送信ボタンで会話を始められます。Vectaix は会話履歴を保存し、思考と回答を順次表示します。回答の読み上げも利用できます。チャットには DeepSeek 公式 API の `deepseek-flash` を使用します。

### 🎨 メディアワークスペース

画像の生成・編集と、Fish Audio S2.1 Pro Free による音声合成を利用できます。

専用メディアモデル：

| モデル | プロバイダー | 機能 |
|:---:|:---:|:---|
| **GPT Image 2.5** | Micu | 画像生成と参照画像を使った画像編集 |
| **Fish Audio S2.1 Pro Free** (`s2.1-pro-free`) | Fish Audio | 多言語音声合成と音声の選択。入力テキストの UTF-8 バイト数に基づき、100万バイトあたり0米ドルで課金 |

<br/>

### 🌐 ウェブブラウジング＆検索

ウェブを検索し、複数のページを読んで回答の参考にできます。

- **スマート検索** — 無料の TinyFish Search で、現在の質問の言語に合わせて最新の情報源を検索
- **ページコンテンツ取得** — 無料の TinyFish Fetch で選択したページをクリーンな Markdown として抽出
- **マルチページブラウジング** — 1セッションで複数ページをクロール
- **インライン引用** — 回答に参照元のリンクを表示できます

検索とページ取得には追加料金がかかりません。資料の読み取りと回答生成に使うモデルの料金は別途かかります。

<br/>

### 📎 プライベートメディアストレージ

メディアワークスペースでは、アップロードした素材と生成した画像・音声をプライベートストレージに保存します。所有者は自分のファイルをプレビュー・ダウンロードできます。

<br/>

### ✨ 会話とカスタマイズ

<table>
<tr>
<td width="50%">

**💬 会話管理**
- MongoDBベースの永続的チャット履歴
- 重要な会話のピン留め
- 会話単位のメモリ・スキル設定

</td>
<td width="50%">

**🎨 テーマ＆カスタマイズ**
- ダーク / ライトモード（システム設定に追従可能）
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
- ログイン・登録のリクエスト頻度を制限
- 管理者ユーザー管理パネル

</td>
</tr>
<tr>
<td width="50%">

**⚙️ 高度なコントロール**
- アシスタントの名前、回答言語、文体を設定
- 会話の指示を設定し、テンプレートとして保存
- メディア解像度設定

</td>
<td width="50%">

**📱 プログレッシブWebアプリ**
- 対応ブラウザーからホーム画面に追加可能
- モバイル最適化レスポンシブUI
- タッチフレンドリーなインターフェース

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
│   │   ├── media/            # 画像・音声の生成
│   │   ├── upload/           # プライベートディスクアップロード
│   │   └── admin/            # 管理機能
│   ├── components/           # React UIコンポーネント
│   │   ├── chat/             # チャット入力と送信
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
| **フロントエンド** | Next.js 16 · React 19 · Tailwind CSS · Framer Motion · Lucide Icons |
| **バックエンド** | Next.js API Routes · Node.js · SSE（Server-Sent Events）ストリーミング |
| **データベース** | MongoDB + Mongoose ODM |
| **ストレージ** | Zeabur マウントディスク（プライベートメディア） |
| **AIプロバイダー** | Micu · Alibaba Cloud Model Studio · Volcengine |
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
| `DEEPSEEK_API_KEY` | ✅ | アシスタント用の DeepSeek 公式 API キー（`deepseek-flash`） |
| `MICU_OPENAI_IMAGE_API_KEY` | — | Micu 画像サービスの API キー |
| `FISH_API_KEY` | — | Fish Audio 公式 API キー。S2.1 Pro Free 音声合成を有効にする場合に設定 |
| `PUBLIC_APP_URL` | — | デプロイ済みアプリの公開HTTPSアドレス。パスキーでのログインに必要 |
| `APP_SECRETS_KEY` | — | 外部接続の認証情報、ブラウザーのログイン状態、定期バックアップのパスワードを暗号化する鍵。これらの機能を使う場合に必要。32バイトのランダムな鍵をBase64形式で指定し、安全に保管してください |
| `TINYFISH_API_KEY` | — | 無料の TinyFish Search と Fetch 共通の API キー。ウェブブラウジングを有効にする場合は必須 |

> [!TIP]
> アシスタントのキーと、利用するメディア・ウェブ機能のキーを設定してください。

<br/>

---

<br/>

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

<br/>

</div>
