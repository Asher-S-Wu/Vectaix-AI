# 花卷

花卷是面向多步骤工作的 Agent 工作台。用户描述目标后，花卷可以制定计划、选择工具、阅读资料、委派只读调查，并交付文档、表格或媒体成果。

## 工作台

- 对话与项目资料保存在 MongoDB，文件保存在私有挂载磁盘。
- 复杂任务通过执行计划展示进度，工具结果和成果文件可追踪。
- 支持网络搜索、网页读取、文件和表格处理、浏览器及 MCP 连接。
- 独立调查由只读子助手完成，主助手核对后汇总。
- 长任务可以保存进度、整理上下文；用户可以停止运行中的任务。
- 浅色、深色与移动端布局，支持键盘操作。

## 管理后台

使用 `ADMIN_EMAILS` 中已注册的管理员账号访问 `/admin`。

### 模型

在后台选择 Chat（Chat Completions）、Message（Anthropic Messages）或 Response（Responses）协议，填写 API 地址和密钥，获取模型列表并保存模型。模型输入能力、上下文长度、输出长度与用量费率由管理员统一设置。新任务使用当前配置，任务执行期间固定模型连接与计价参数。

### 技能

管理员通过后台调用 Skills CLI 安装、更新、启用或移除公开 GitHub 仓库中的技能。已启用技能对所有用户生效，Agent 按需读取技能与附件。技能内容和附件存入 MongoDB，CLI 工作目录保存在 `STORAGE_ROOT/skills`。

### Media

管理员在 `/admin/media` 配置图片和语音服务的地址、密钥及共享参数，并在工作区管理图片生成与音色。配置完成后，用户可以直接让花卷制作图片或配音。每个用户的生成文件与费用记录分别保存。

密钥使用 `APP_SECRETS_KEY` 加密存储，后台只显示密钥是否已保存。

## Railway 部署

项目使用 Node.js 24、Next.js 16、React 19 与 MongoDB，部署采用仓库中的 Railpack 配置。

| 环境变量 | 用途 |
| --- | --- |
| `MONGO_URI` | MongoDB 连接地址 |
| `APP_SECRETS_KEY` | 32 字节随机密钥的 Base64 编码，用于加密服务凭据 |
| `ADMIN_EMAILS` | 管理员邮箱，多个邮箱使用逗号分隔；对应账号需已注册 |
| `STORAGE_ROOT` | Railway 持久磁盘的文件存储路径 |
| `PUBLIC_APP_URL` | 网站的公开 HTTPS 地址 |
| `NEXT_PUBLIC_APP_URL` | 前端使用的网站公开地址 |

Railway 服务需挂载持久磁盘，并提供 Git，以便 Skills CLI 安装与更新技能。模型和媒体密钥在后台配置。

安装依赖后运行 `npm run dev`；生产构建使用 `npm run build`，启动使用 `npm start`。

## 验证

`npm run lint` 检查代码，`npm test` 运行服务端测试。界面测试使用 `tests/helpers/dev-server.mjs` 启动独立测试数据库和 3100 端口，再运行 `npm run test:ui`。

## 架构参考

- [OpenCode Agent](https://opencode.ai/docs/agents/)
- [Skills CLI](https://github.com/vercel-labs/skills)
