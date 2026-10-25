const messages = [
  [
    "没有模型 {0} 的计费费率",
    "No billing rate is configured for model {0}"
  ],
  [
    "缓存输入 token 不能超过总输入 token",
    "Cached input tokens must not exceed total input tokens"
  ],
  [
    "用量记录时间无效",
    "The usage record timestamp is invalid"
  ],
  [
    "计费节假日日历需要更新",
    "The billing holiday calendar needs to be updated"
  ],
  [
    "没有图片模型 {0} 的计费费率",
    "No billing rate is configured for image model {0}"
  ],
  [
    "图片用量明细不完整：缺少 usage",
    "Image usage details are incomplete: usage is missing"
  ],
  [
    "图片输入用量明细不完整",
    "Image input usage details are incomplete"
  ],
  [
    "图片输入总用量与文字、图片分类用量不一致",
    "Total image input usage does not match the text and image breakdown"
  ],
  [
    "图片总用量与输入、输出用量不一致",
    "Total image usage does not match input and output usage"
  ],
  [
    "图片缓存用量明细不完整",
    "Image cache usage details are incomplete"
  ],
  [
    "图片缓存用量明细不完整：缺少文字和图片缓存分类",
    "Image cache usage details are incomplete: the text and image cache breakdown is missing"
  ],
  [
    "图片缓存总用量与分类用量不一致",
    "Total image cache usage does not match its breakdown"
  ],
  [
    "图片缓存用量不能超过对应分类的输入用量",
    "Cached image usage must not exceed input usage in the corresponding category"
  ],
  [
    "图片输出用量明细不完整",
    "Image output usage details are incomplete"
  ],
  [
    "图片模型的文字输出没有对应费率",
    "No rate is configured for text output from the image model"
  ],
  [
    "图片输出用量与总输出用量不一致",
    "Image output usage does not match total output usage"
  ],
  [
    "缺少 Fish Audio S2.1 Pro 费率",
    "The Fish Audio S2.1 Pro rate is missing"
  ],
  [
    "{0} 不是有效用户 ID",
    "{0} is not a valid user ID"
  ],
  [
    "operationId 必须是 1 到 200 个字符的字符串",
    "operationId must be a string of 1 to 200 characters"
  ],
  [
    "claimId 必须是 1 到 200 个字符的字符串",
    "claimId must be a string of 1 to 200 characters"
  ],
  [
    "{0} 必须是非空字符串数组",
    "{0} must be an array of nonempty strings"
  ],
  [
    "{0} 包含无效数字",
    "{0} contains an invalid number"
  ],
  [
    "{0}.{1} 不能是 undefined",
    "{0}.{1} must not be undefined"
  ],
  [
    "{0} 包含不支持的值",
    "{0} contains an unsupported value"
  ],
  [
    "用户不存在或审计标识初始化失败",
    "The user was not found, or their audit ID could not be initialized"
  ],
  [
    "同一 operationId 的请求内容不一致",
    "Requests with the same operationId have different content"
  ],
  [
    "同一 operationId 的用户不一致",
    "Requests with the same operationId refer to different users"
  ],
  [
    "同一 operationId 的操作人不一致",
    "Requests with the same operationId have different actors"
  ],
  [
    "同一 operationId 的 {0} 不一致",
    "Requests with the same operationId have different values for {0}"
  ],
  [
    "operationId 已被其他用户使用",
    "This operationId is already in use by another user"
  ],
  [
    "花费记录不存在",
    "The spending record was not found"
  ],
  [
    "请求执行 claim 已变化，不能移交给异步任务",
    "The request execution claim has changed, so it cannot be handed off to a background task"
  ],
  [
    "同一 operationId 的人民币成本不一致",
    "Requests with the same operationId have different CNY costs"
  ],
  [
    "同一 operationId 的美元成本不一致",
    "Requests with the same operationId have different USD costs"
  ],
  [
    "同一 operationId 的结算操作人不一致",
    "Requests with the same operationId have different settlement actors"
  ],
  [
    "同一 operationId 的结算原因不一致",
    "Requests with the same operationId have different settlement reasons"
  ],
  [
    "本次请求已提交，请勿重复提交",
    "This request has already been submitted. Please avoid submitting it again."
  ],
  [
    "本次请求已经结束，不能修改结果",
    "This request has ended, and its result can no longer be changed"
  ],
  [
    "实际人民币花费必须是非负有限数字",
    "The actual CNY cost must be a finite, nonnegative number"
  ],
  [
    "reason 必须是非空字符串",
    "reason must be a nonempty string"
  ],
  [
    "孤儿流水清理数量必须是 1 到 1000 的整数",
    "The number of orphaned records to clean up must be an integer from 1 to 1,000"
  ],
  [
    "执行进程中断，无法确认最终用量",
    "The process was interrupted, so final usage could not be confirmed"
  ],
  [
    "文件夹不存在",
    "The folder was not found"
  ],
  [
    "一次最多上传 50 个文件，总大小不超过 100 MB",
    "Upload up to 50 files at a time, with a combined size of up to 100 MB"
  ],
  [
    "文件内容与扩展名不匹配",
    "The file content does not match its extension"
  ],
  [
    "文件名称",
    "File name"
  ],
  [
    "文件名称不能包含路径",
    "The file name must not contain a path"
  ],
  [
    "只能编辑 200 KB 以内的文本文件",
    "Only text files of up to 200 KB can be edited"
  ],
  [
    "文件内容不能为空",
    "File content is required"
  ],
  [
    "只能读取 200 KB 以内的文本文件",
    "Only text files of up to 200 KB can be read"
  ],
  [
    "不能移动到自己或子文件夹中",
    "A folder cannot be moved into itself or one of its subfolders"
  ],
  [
    "请选择 1 到 100 个文件",
    "Select between 1 and 100 files"
  ],
  [
    "项目不存在",
    "The project was not found"
  ],
  [
    "（共 {0} 个文件不可删除）",
    "({0} files cannot be deleted)"
  ],
  [
    "请选择要删除的文件",
    "Select the files to delete"
  ],
  [
    "上传内容超过大小限制",
    "The upload exceeds the size limit"
  ],
  [
    "上传表单无效或超过大小限制",
    "The upload form is invalid or exceeds the size limit"
  ],
  [
    "连接不存在",
    "The connection was not found"
  ],
  [
    "请输入 80 字以内的名称",
    "Enter a name of up to 80 characters"
  ],
  [
    "连接类型无效",
    "The connection type is invalid"
  ],
  [
    "认证方式无效",
    "The authentication method is invalid"
  ],
  [
    "凭据无效",
    "The credentials are invalid"
  ],
  [
    "连接名称无效",
    "The connection name is invalid"
  ],
  [
    "开关值无效",
    "The toggle value is invalid"
  ],
  [
    "工具选择无效",
    "The tool selection is invalid"
  ],
  [
    "请先开启外部工具权限",
    "Enable permission to use external tools first"
  ],
  [
    "请在连接设置中重新授权",
    "Authorize the connection again in its settings"
  ],
  [
    "授权已失效",
    "Authorization has expired"
  ],
  [
    "请先配置连接密钥",
    "Configure the connection key first"
  ],
  [
    "请先在连接设置中完成授权",
    "Complete authorization in the connection settings first"
  ],
  [
    "连接失败，请检查地址、密钥或重新授权",
    "Connection failed. Check the URL and key, or authorize the connection again."
  ],
  [
    "单个连接最多支持 200 个工具",
    "Each connection supports up to 200 tools"
  ],
  [
    "不能访问内部网络",
    "Access to internal networks is blocked"
  ],
  [
    "连接端点发生重定向，请使用最终地址",
    "The connection endpoint redirected the request. Use its final URL."
  ],
  [
    "远端路径无效",
    "The remote path is invalid"
  ],
  [
    "请粘贴包含 mcpServers 的配置",
    "Paste a configuration that includes mcpServers"
  ],
  [
    "只支持 Streamable HTTP 连接，不支持本地命令或旧版 SSE",
    "Only Streamable HTTP connections are supported. Local commands and legacy SSE are not supported."
  ],
  [
    "配置只接受 Authorization 或 X-API-Key 认证",
    "The configuration accepts only Authorization or X-API-Key authentication"
  ],
  [
    "Authorization 必须为 Bearer 密钥",
    "Authorization must use a Bearer token"
  ],
  [
    "当前系统不支持安装远端文件运行工具",
    "The current operating system does not support installing the remote file tool"
  ],
  [
    "rclone 下载文件校验失败",
    "The downloaded rclone file failed verification"
  ],
  [
    "连接配置包含非法字符",
    "The connection configuration contains invalid characters"
  ],
  [
    "远端连接未启用",
    "The remote connection is disabled"
  ],
  [
    "SFTP 需要填写服务器 known_hosts 公钥",
    "SFTP requires the server’s known_hosts public key"
  ],
  [
    "请输入目标文件路径",
    "Enter the destination file path"
  ],
  [
    "连接或工具已停用",
    "The connection or tool is disabled"
  ],
  [
    "外部工具未返回确定结果，未自动重试，请核实外部系统",
    "The external tool returned an uncertain result and was not retried automatically. Check the external system."
  ],
  [
    "连接或资料已停用",
    "The connection or resource is disabled"
  ],
  [
    "连接或提示模板已停用",
    "The connection or prompt template is disabled"
  ],
  [
    "文件不存在或超过 20 MB",
    "The file was not found or exceeds 20 MB"
  ],
  [
    "媒体配置格式无效",
    "The media settings format is invalid"
  ],
  [
    "媒体配置包含未知字段",
    "The media settings contain unknown fields"
  ],
  [
    "请选择是否启用媒体服务",
    "Choose whether to enable the media service"
  ],
  [
    "服务地址无效",
    "The service URL is invalid"
  ],
  [
    "请填写完整的公开 HTTPS 服务地址",
    "Enter a complete, public HTTPS service URL"
  ],
  [
    "密钥格式无效",
    "The key format is invalid"
  ],
  [
    "切换服务地址时请重新填写密钥",
    "Enter the key again when changing the service URL"
  ],
  [
    "请选择 Fish Audio 服务",
    "Select the Fish Audio service"
  ],
  [
    "音色编号格式无效",
    "The voice ID format is invalid"
  ],
  [
    "启用前请填写服务密钥",
    "Enter the service key before enabling it"
  ],
  [
    "请选择要保存的媒体配置",
    "Choose the media settings to save"
  ],
  [
    "请管理员在后台启用并配置媒体服务",
    "Ask an admin to enable and configure media services in the admin panel"
  ],
  [
    "模型加载失败",
    "Models failed to load"
  ],
  [
    "请输入完整的模型服务地址",
    "Enter the complete model service URL"
  ],
  [
    "模型地址应为 HTTPS 地址，且没有账号、查询参数或片段",
    "The model URL must use HTTPS and contain no credentials, query parameters, or fragment"
  ],
  [
    "请选择 Chat、Message 或 Response 协议",
    "Choose the Chat, Message, or Response protocol"
  ],
  [
    "模型设置格式无效",
    "The model settings format is invalid"
  ],
  [
    "请选择有效模型",
    "Choose a valid model"
  ],
  [
    "上下文长度需为 1024 至 10000000 的整数",
    "The context window must be an integer from 1,024 to 10,000,000"
  ],
  [
    "输出长度需至少 256，并小于上下文长度",
    "The output limit must be at least 256 and smaller than the context window"
  ],
  [
    "请设置工具调用能力",
    "Set whether the model can call tools"
  ],
  [
    "模型输入类型请选择文字或图片",
    "Choose text or images as model input types"
  ],
  [
    "费率需为 0 至 100000 之间的美元金额",
    "The rate must be a USD amount from 0 to 100,000"
  ],
  [
    "API Key 格式无效",
    "The API key format is invalid"
  ],
  [
    "切换服务地址或协议时，请重新输入 API Key",
    "Enter the API key again when changing the service URL or protocol"
  ],
  [
    "请先输入此服务的 API Key",
    "Enter the API key for this service first"
  ],
  [
    "模型列表获取失败，请检查服务地址和网络",
    "The model list could not be loaded. Check the service URL and network connection."
  ],
  [
    "API Key 验证失败，请检查后重试",
    "API key verification failed. Check the key and try again."
  ],
  [
    "模型服务返回 HTTP {0}，请检查地址和协议",
    "The model service returned HTTP {0}. Check the URL and protocol."
  ],
  [
    "模型服务返回了无效的列表",
    "The model service returned an invalid list"
  ],
  [
    "模型服务返回的列表格式无效",
    "The model service returned a list in an invalid format"
  ],
  [
    "模型列表分页信息无效",
    "The model list pagination is invalid"
  ],
  [
    "模型列表超过 50 页，请缩小服务提供的模型范围",
    "The model list exceeds 50 pages. Limit the models exposed by the service."
  ],
  [
    "请管理员在后台配置模型服务",
    "Ask an admin to configure the model service in the admin panel"
  ],
  [
    "此模型已停用，请使用管理员当前设置的模型",
    "This model is disabled. Use the model currently selected by the admin."
  ],
  [
    "请管理员在后台配置模型地址、模型和 API Key",
    "Ask an admin to configure the model URL, model, and API key in the admin panel"
  ],
  [
    "对话内容格式无效",
    "The conversation content format is invalid"
  ],
  [
    "历史回复格式无效",
    "A previous response has an invalid format"
  ],
  [
    "请使用文字或图片继续对话",
    "Continue the conversation with text or images"
  ],
  [
    "对话消息类型无效",
    "The conversation message type is invalid"
  ],
  [
    "对话上下文无效",
    "The conversation context is invalid"
  ],
  [
    "工具返回的内容格式无效",
    "The tool returned content in an invalid format"
  ],
  [
    "助手尚未完成这次回复",
    "The assistant has not finished this response"
  ],
  [
    "回复达到长度上限，请缩短问题后再试",
    "The response reached its length limit. Shorten your question and try again."
  ],
  [
    "对话服务回复失败，请稍后再试",
    "The chat service failed to respond. Please try again later."
  ],
  [
    "对话连接中断，回复尚未完成",
    "The chat connection was interrupted before the response finished"
  ],
  [
    "对话服务返回的 token 用量不完整",
    "The chat service returned incomplete token usage"
  ],
  [
    "对话服务返回的上下文格式无效",
    "The chat service returned context in an invalid format"
  ],
  [
    "回复长度设置无效",
    "The response length setting is invalid"
  ],
  [
    "助手尚未生成可显示的回复，请重新发送",
    "The assistant has not produced a response to display. Please send your message again."
  ],
  [
    "助手返回了未授权或无效的工具调用",
    "The assistant returned an unauthorized or invalid tool call"
  ],
  [
    "助手返回的工具参数格式无效",
    "The assistant returned tool arguments in an invalid format"
  ],
  [
    "工具调用轮次已用完，请继续对话完成任务",
    "The tool call limit has been reached. Continue the conversation to finish the task."
  ],
  [
    "模型协议配置无效，请联系管理员",
    "The model protocol settings are invalid. Contact an admin."
  ],
  [
    "图片内容格式无效",
    "The image content format is invalid"
  ],
  [
    "工具调用编号无效",
    "The tool call ID is invalid"
  ],
  [
    "回复达到长度上限，请调整输出长度后再试",
    "The response reached its length limit. Adjust the output limit and try again."
  ],
  [
    "对话服务结束了本次生成，请调整问题后重试",
    "The chat service ended generation. Revise your question and try again."
  ],
  [
    "对话服务返回的工具调用状态无效",
    "The chat service returned an invalid tool call status"
  ],
  [
    "对话服务未返回内容",
    "The chat service returned no content"
  ],
  [
    "对话服务返回了无效的事件",
    "The chat service returned an invalid event"
  ],
  [
    "模型单次事件过大",
    "A single model event exceeded the size limit"
  ],
  [
    "对话连接中断，事件尚未接收完整",
    "The chat connection was interrupted before the full event was received"
  ],
  [
    "对话服务认证失败，请联系管理员",
    "Chat service authentication failed. Contact an admin."
  ],
  [
    "对话请求过于频繁，请稍后再试",
    "Chat requests are being sent too frequently. Please try again later."
  ],
  [
    "模型请求失败，请管理员检查 Message 协议设置",
    "The model request failed. Ask an admin to check the Message protocol settings."
  ],
  [
    "模型回复内容格式无效",
    "The model response content has an invalid format"
  ],
  [
    "模型回复内容顺序无效",
    "The model response content arrived in an invalid order"
  ],
  [
    "模型回复失败，请稍后重试",
    "The model failed to respond. Please try again later."
  ],
  [
    "{0}不能为空",
    "{0} is required"
  ],
  [
    "联网服务尚未配置，请联系管理员",
    "The web service has not been configured. Contact an admin."
  ],
  [
    "网页服务器返回错误",
    "The web server returned an error"
  ],
  [
    "网页访问连接失败",
    "The connection to the web page failed"
  ],
  [
    "网页没有可读取的正文",
    "The web page has no readable body text"
  ],
  [
    "连接地址或端口不受支持",
    "The connection URL or port is not supported"
  ],
  [
    "不能访问本机或内部网络",
    "Access to the local machine and internal networks is blocked"
  ],
  [
    "连接地址必须解析到公开网络",
    "The connection URL must resolve to a public network address"
  ],
  [
    "请配置 APP_SECRETS_KEY（32 字节随机密钥的 Base64 编码）",
    "Configure APP_SECRETS_KEY with a Base64-encoded random 32-byte key"
  ],
  [
    "缺少凭据所属范围",
    "The credential scope is missing"
  ],
  [
    "助手头像不存在或无权访问",
    "The assistant avatar was not found or you do not have access"
  ],
  [
    "头像文件无效",
    "The avatar file is invalid"
  ],
  [
    "头像文件不存在或无权访问",
    "The avatar file was not found or you do not have access"
  ],
  [
    "使用权限已更改，任务已停止",
    "Access permissions changed, so the task was stopped"
  ],
  [
    "请使用管理员账号管理技能",
    "Use an admin account to manage skills"
  ],
  [
    "技能操作失败，请检查服务器配置",
    "The skill operation failed. Check the server configuration."
  ],
  [
    "压缩包包含非法文件路径",
    "The archive contains an invalid file path"
  ],
  [
    "压缩包文件数量过多",
    "The archive contains too many files"
  ],
  [
    "不支持符号链接",
    "Symbolic links are not supported"
  ],
  [
    "压缩包过大、文件过多或路径重复",
    "The archive is too large, contains too many files, or has duplicate paths"
  ],
  [
    "备份中的文件数量过多",
    "The backup contains too many files"
  ],
  [
    "备份包含符号链接或重复路径",
    "The backup contains symbolic links or duplicate paths"
  ],
  [
    "备份解压后超过大小限制",
    "The extracted backup exceeds the size limit"
  ],
  [
    "请填写公开 GitHub 仓库地址",
    "Enter a public GitHub repository URL"
  ],
  [
    "仓库地址包含无效路径",
    "The repository URL contains an invalid path"
  ],
  [
    "请填写 owner/repo 或公开 GitHub 仓库地址",
    "Enter owner/repo or a public GitHub repository URL"
  ],
  [
    "请使用公开 GitHub 仓库或 tree 目录地址",
    "Use a public GitHub repository URL or a tree directory URL"
  ],
  [
    "技能名称仅使用字母、数字、点、短横线和下划线",
    "Skill names may contain only letters, numbers, periods, hyphens, and underscores"
  ],
  [
    "另一个技能操作正在进行，请完成后再操作",
    "Another skill operation is running. Wait for it to finish."
  ],
  [
    "Skills CLI 执行超过 2 分钟，请检查仓库连接后重试",
    "Skills CLI ran for more than 2 minutes. Check the repository connection and try again."
  ],
  [
    "Skills CLI 操作失败，请检查仓库地址、技能名称和服务器的 Git 配置",
    "The Skills CLI operation failed. Check the repository URL, skill name, and server Git configuration."
  ],
  [
    "技能安装目录缺失，请检查源仓库和技能名称",
    "The skill installation directory is missing. Check the source repository and skill name."
  ],
  [
    "技能目录超出专用工作空间",
    "The skill directory is outside its dedicated workspace"
  ],
  [
    "技能安装目录包含异常文件或链接",
    "The skill installation directory contains unexpected files or links"
  ],
  [
    "技能包最多包含 1000 个文件和目录",
    "A skill package can contain up to 1,000 files and directories"
  ],
  [
    "技能文件应使用实际文件，请移除符号链接",
    "Skill files must be regular files. Remove symbolic links."
  ],
  [
    "技能文件超出安装目录",
    "The skill file is outside the installation directory"
  ],
  [
    "技能包总计最多 50 MB，单个附件最多 8 MB",
    "A skill package can total up to 50 MB, with each attachment up to 8 MB"
  ],
  [
    "技能 {0} 缺少 SKILL.md",
    "Skill {0} is missing SKILL.md"
  ],
  [
    "技能内容不能为空，且最多 20 万字",
    "Skill content is required and can contain up to 200,000 characters"
  ],
  [
    "技能缺少完整的 YAML 文件头",
    "The skill is missing a complete YAML header"
  ]
];

export default messages;
