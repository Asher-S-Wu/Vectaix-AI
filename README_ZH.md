# 花卷

[English](README.md) | 简体中文

花卷是面向多步骤工作的 Agent 工作台。用户描述目标后，花卷可以制定计划、选择工具、阅读资料、委派只读调查，并交付文档、表格或媒体成果。

## 工作台

- 对话与项目资料保存在 MongoDB，文件保存在私有挂载磁盘。
- 复杂任务通过执行计划展示进度，工具结果和成果文件可追踪。
- 支持网络搜索、网页读取、文件和表格处理、浏览器及 MCP 连接。
- 独立调查由只读子助手完成，主助手核对后汇总。
- 长任务可以保存进度、整理上下文；用户可以停止运行中的任务。
- 浅色、深色与移动端布局，支持键盘操作。

## 管理后台

使用 `ADMIN_EMAILS` 中已注册的账号登录，然后在「设置」中打开「管理后台」（`/settings?section=admin`）。

### 模型

在后台选择 Chat（Chat Completions）、Message（Anthropic Messages）或 Response（Responses）协议，填写 API 地址和密钥，获取模型列表并保存模型。模型输入能力、上下文长度、输出长度与用量费率由管理员统一设置。新任务使用当前配置，任务执行期间固定模型连接与计价参数。

### 技能

「全局技能」通过 Skills CLI 安装、更新和删除来自公开 GitHub 仓库的技能。管理员启用的技能对所有用户生效，花卷会按任务读取技能和附件。技能内容和附件存入 MongoDB，CLI 的工作目录位于 `STORAGE_ROOT/skills`。

### 图片与语音

在管理后台打开「图片与语音」（`/settings?section=admin&adminSection=media`），配置服务地址、密钥和共享参数。「图片生成」和「语音合成」页签可管理图片设置和音色。配置完成后，用户可以直接让花卷制作图片或配音。每个用户的生成文件与费用记录分别保存。

密钥使用 `APP_SECRETS_KEY` 加密存储，后台只显示密钥是否已保存。

## Railway 部署

项目使用 Node.js 26、Next.js 16、React 19 与 MongoDB。部署时使用仓库中的 `railpack.json`，并在 Railway 服务上挂载持久磁盘。Railpack 会安装 Git，供 Skills CLI 使用。

| 环境变量 | 用途 |
| --- | --- |
| `MONGO_URI` | MongoDB 连接地址 |
| `APP_SECRETS_KEY` | 32 字节随机密钥的 Base64 编码，用于加密服务凭据 |
| `ADMIN_EMAILS` | 管理员邮箱，多个邮箱用逗号分隔。请先注册账号，再添加邮箱。 |
| `STORAGE_ROOT` | 用于存储文件的 Railway 持久磁盘挂载路径 |
| `PUBLIC_APP_URL` | 注册和使用通行密钥时所需的网站公开 HTTPS 地址 |
| `NEXT_PUBLIC_APP_URL` | 生成 MCP OAuth 回调地址时使用的网站公开地址 |

## 本地运行

在 `.env.local` 中将 `MONGO_URI` 指向开发数据库，将 `STORAGE_ROOT` 设为可写目录，并按上表的格式设置 `APP_SECRETS_KEY`。

```sh
npm ci
npm run dev
```

使用 `npm run build` 构建生产版本，再用 `npm start` 启动。

## 验证

`npm run lint` 检查代码，`npm test` 运行服务端测试。

运行界面测试前，用 `npx playwright install chromium --only-shell` 安装 Chromium。运行 `node tests/helpers/dev-server.mjs` 启动独立测试数据库和 3100 端口的应用，再打开另一个终端运行 `npm run test:ui`。

## 架构参考

- [OpenCode Agent](https://opencode.ai/docs/agents/)
- [Skills CLI](https://github.com/vercel-labs/skills)
