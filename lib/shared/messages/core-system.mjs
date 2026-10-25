const coreSystemMessages = [
  [
    "请先登录",
    "Please sign in."
  ],
  [
    "需要管理员权限",
    "Administrator access is required."
  ],
  [
    "媒体配置保存失败，请检查服务设置",
    "Could not save media settings. Check the service configuration."
  ],
  [
    "无效的用户 ID",
    "Invalid user ID."
  ],
  [
    "不支持的操作",
    "Unsupported action."
  ],
  [
    "用户不存在",
    "User not found."
  ],
  [
    "不能重置其他超级管理员的密码",
    "Only the account owner can reset this super administrator's password."
  ],
  [
    "不能删除自己的账号",
    "You cannot delete your own account here."
  ],
  [
    "不能删除其他超级管理员账号",
    "You cannot delete another super administrator's account."
  ],
  [
    "删除用户失败，账号已保持删除中状态，请稍后重试",
    "User deletion failed. The account remains marked for deletion. Try again later."
  ],
  [
    "登录已过期，请重新登录",
    "Your session has expired. Please sign in again."
  ],
  [
    "请求体格式错误",
    "Invalid request body."
  ],
  [
    "请输入新邮箱",
    "Enter your new email address."
  ],
  [
    "请输入当前密码",
    "Enter your current password."
  ],
  [
    "请输入有效的邮箱地址",
    "Enter a valid email address."
  ],
  [
    "该邮箱为系统保留的管理员邮箱，不能设置为账号邮箱",
    "This address is reserved for the administrator. Choose another email address."
  ],
  [
    "超级管理员邮箱由部署配置统一管理，不能在站内修改",
    "The super administrator's email is managed in the deployment settings."
  ],
  [
    "新邮箱与当前邮箱相同",
    "Enter an email address different from your current one."
  ],
  [
    "密码错误",
    "Incorrect password."
  ],
  [
    "该邮箱已被其他用户使用",
    "This email address belongs to another account."
  ],
  [
    "修改邮箱失败",
    "Could not change the email address."
  ],
  [
    "请填写所有密码字段",
    "Complete all password fields."
  ],
  [
    "两次输入的新密码不一致",
    "The new passwords do not match."
  ],
  [
    "当前密码错误",
    "Incorrect current password."
  ],
  [
    "修改密码失败，请稍后再试",
    "Could not change the password. Try again later."
  ],
  [
    "登录尝试次数过多，请稍后再试",
    "Too many sign-in attempts. Try again later."
  ],
  [
    "邮箱和密码格式错误",
    "Invalid email or password format."
  ],
  [
    "请填写邮箱和密码",
    "Enter your email and password."
  ],
  [
    "邮箱或密码错误",
    "Incorrect email or password."
  ],
  [
    "登录失败，请稍后再试",
    "Sign-in failed. Try again later."
  ],
  [
    "通行密钥不存在",
    "Passkey not found."
  ],
  [
    "尝试次数过多，请稍后再试",
    "Too many attempts. Try again later."
  ],
  [
    "验证已过期，请重新开始",
    "Verification has expired. Start again."
  ],
  [
    "不支持的通行密钥操作",
    "Unsupported passkey action."
  ],
  [
    "通行密钥验证未完成，请检查网站地址和设备支持情况",
    "Passkey verification was not completed. Check the website address and device support."
  ],
  [
    "注册尝试次数过多，请稍后再试",
    "Too many registration attempts. Try again later."
  ],
  [
    "邮箱或密码格式错误",
    "Invalid email or password format."
  ],
  [
    "请填写所有必填字段",
    "Complete all required fields."
  ],
  [
    "该邮箱为系统保留的管理员邮箱，不能公开注册",
    "This address is reserved for the administrator. Register with another email address."
  ],
  [
    "两次输入的密码不一致",
    "The passwords do not match."
  ],
  [
    "该邮箱已注册",
    "This email address is already registered."
  ],
  [
    "注册失败，请稍后再试",
    "Registration failed. Try again later."
  ],
  [
    "定时备份状态",
    "Scheduled backup status"
  ],
  [
    "定时备份不存在",
    "Scheduled backup not found."
  ],
  [
    "请先开启浏览器权限",
    "Enable browser access first."
  ],
  [
    "浏览器正忙，请稍后打开",
    "The browser is busy. Open it again later."
  ],
  [
    "当前对话与所选模型不匹配",
    "The selected model does not match this conversation."
  ],
  [
    "最多支持 {0} 张参考图片",
    "Use up to {0} reference images."
  ],
  [
    "参考图片不存在或无权访问",
    "The reference image is missing or access is denied."
  ],
  [
    "参考图片格式不受支持",
    "Unsupported reference image format."
  ],
  [
    "此接口仅支持图片生成",
    "This endpoint accepts image generation requests only."
  ],
  [
    "请求过于频繁，请稍后再试",
    "Too many requests. Try again later."
  ],
  [
    "重新生成缺少用户消息",
    "A user message is required to regenerate a reply."
  ],
  [
    "媒体模型仅支持图片作为参考附件",
    "Media models accept images as reference attachments."
  ],
  [
    "第 {0} 张：{1}",
    "Image {0}: {1}"
  ],
  [
    "请求包含无效数字",
    "The request contains an invalid number."
  ],
  [
    "请求包含无法生成指纹的内容",
    "The request contains data that cannot be fingerprinted."
  ],
  [
    "请求操作号无效，请刷新页面后重试",
    "Invalid operation ID. Refresh the page and try again."
  ],
  [
    "请至少输入内容或上传附件",
    "Enter a message or upload an attachment."
  ],
  [
    "附件不存在或无权访问",
    "The attachment is missing or access is denied."
  ],
  [
    "附件已被其他内容占用",
    "The attachment is already used by other content."
  ],
  [
    "当前模型不支持这类文件",
    "This model does not accept this file type."
  ],
  [
    "聊天费用记录状态异常",
    "The conversation billing record has an invalid status."
  ],
  [
    "对话内容超过该模型的上下文长度，请减少附件或开始新对话",
    "The conversation exceeds the model's context limit. Remove attachments or start a new conversation."
  ],
  [
    "联网工具调用超出限制：{0}",
    "Web tool limit exceeded: {0}"
  ],
  [
    "联网搜索失败",
    "Web search failed."
  ],
  [
    "模型服务认证失败，请检查接口配置",
    "Model authentication failed. Check the API configuration."
  ],
  [
    "授权未完成",
    "Authorization was not completed."
  ],
  [
    "授权请求已失效",
    "The authorization request has expired."
  ],
  [
    "授权未完成，请回到设置重新发起授权",
    "Authorization was not completed. Start again from Settings."
  ],
  [
    "一次最多导入 20 个连接",
    "Import up to 20 connections at a time."
  ],
  [
    "写回远端文件需要明确确认",
    "Confirm before writing to a remote file."
  ],
  [
    "此连接未使用 OAuth",
    "This connection does not use OAuth."
  ],
  [
    "创建对话失败",
    "Could not create the conversation."
  ],
  [
    "对话不存在",
    "Conversation not found."
  ],
  [
    "请使用文件上传表单",
    "Use the file upload form."
  ],
  [
    "文件大小不能超过 20MB",
    "Choose a file of 20 MB or less."
  ],
  [
    "文件上传表单格式不正确",
    "Invalid file upload form."
  ],
  [
    "每次只能上传一个文件",
    "Upload one file at a time."
  ],
  [
    "文件编号无效",
    "Invalid file ID."
  ],
  [
    "删除对话失败",
    "Could not delete the conversation."
  ],
  [
    "更新失败",
    "Update failed."
  ],
  [
    "未登录",
    "Please sign in."
  ],
  [
    "文件不存在",
    "File not found."
  ],
  [
    "读取文件失败",
    "Could not read the file."
  ],
  [
    "已使用的文件不能直接删除",
    "Remove references to this file before deleting it."
  ],
  [
    "文件不存在或正在使用",
    "The file is missing or in use."
  ],
  [
    "读取语音记录失败",
    "Could not load audio history."
  ],
  [
    "语音生成请求较多，请稍后再试",
    "Too many audio generation requests. Try again later."
  ],
  [
    "语音生成失败",
    "Audio generation failed."
  ],
  [
    "语音记录不存在",
    "Audio record not found."
  ],
  [
    "删除语音记录失败",
    "Could not delete the audio record."
  ],
  [
    "试听请求较多，请稍后再试",
    "Too many preview requests. Try again later."
  ],
  [
    "音色试听失败",
    "Voice preview failed."
  ],
  [
    "读取声音库失败",
    "Could not load the voice library."
  ],
  [
    "声音复刻请求较多，请稍后再试",
    "Too many voice cloning requests. Try again later."
  ],
  [
    "请填写 1 到 60 个字的音色名称",
    "Enter a voice name of 1 to 60 characters."
  ],
  [
    "请确认拥有声音样本的使用授权",
    "Confirm that you have permission to use the voice sample."
  ],
  [
    "请上传 20 MB 以内的声音样本",
    "Upload a voice sample of 20 MB or less."
  ],
  [
    "请上传 WAV、MP3 或 M4A 音频",
    "Upload WAV, MP3, or M4A audio."
  ],
  [
    "声音样本内容有误，请重新选择可播放的音频文件",
    "The voice sample is invalid. Select a playable audio file."
  ],
  [
    "声音样本时长须在 10 秒到 5 分钟之间",
    "The voice sample must be between 10 seconds and 5 minutes long."
  ],
  [
    "最多保存 {0} 个复刻音色，请先删除闲置音色",
    "You can save up to {0} cloned voices. Delete an unused voice first."
  ],
  [
    "声音复刻失败",
    "Voice cloning failed."
  ],
  [
    "复刻音色不存在",
    "Cloned voice not found."
  ],
  [
    "删除复刻音色失败",
    "Could not delete the cloned voice."
  ],
  [
    "刷新音色状态失败",
    "Could not refresh the voice status."
  ],
  [
    "图片编辑失败",
    "Image editing failed."
  ],
  [
    "图片生成失败",
    "Image generation failed."
  ],
  [
    "项目仍有进行中的任务，请先停止任务",
    "Stop the project's active tasks first."
  ],
  [
    "保存失败",
    "Save failed."
  ],
  [
    "删除失败",
    "Deletion failed."
  ],
  [
    "步骤游标无效",
    "Invalid step cursor."
  ],
  [
    "朗读请求过于频繁",
    "Too many read-aloud requests."
  ],
  [
    "朗读失败，请检查配音服务设置",
    "Read-aloud failed. Check the speech service settings."
  ],
  [
    "网站地址尚未配置，无法使用通行密钥",
    "Configure the website URL to use passkeys."
  ],
  [
    "通行密钥需要 HTTPS 网站地址",
    "Passkeys require an HTTPS website URL."
  ],
  [
    "请重新登录",
    "Please sign in again."
  ],
  [
    "验证已过期或已经使用，请重新开始",
    "Verification has expired or has already been used. Start again."
  ],
  [
    "账号不可用",
    "This account is unavailable."
  ],
  [
    "通行密钥验证失败",
    "Passkey verification failed."
  ],
  [
    "通行密钥未注册",
    "This passkey is not registered."
  ],
  [
    "通行密钥状态已变化，请重新验证",
    "The passkey status has changed. Verify again."
  ],
  [
    "密码不能为空",
    "Enter a password."
  ],
  [
    "密码长度至少为 {0} 个字符",
    "Use at least {0} characters for your password."
  ],
  [
    "密码必须包含至少一个大写字母",
    "Include at least one uppercase letter in your password."
  ],
  [
    "密码必须包含至少一个小写字母",
    "Include at least one lowercase letter in your password."
  ],
  [
    "密码必须包含至少一个数字",
    "Include at least one number in your password."
  ],
  [
    "备份密码需要 10 到 200 个字符",
    "Use 10 to 200 characters for the backup password."
  ],
  [
    "备份文件大小无效",
    "Invalid backup file size."
  ],
  [
    "这不是 花卷 加密备份",
    "Select a Huajuan encrypted backup."
  ],
  [
    "密码错误或备份文件已损坏",
    "The password is incorrect or the backup is damaged."
  ],
  [
    "已有备份或恢复任务正在进行，请完成后再操作",
    "Wait for the current backup or restore to finish."
  ],
  [
    "备份内容总大小不能超过 512 MB",
    "Backup content must be 512 MB or less."
  ],
  [
    "备份超过 1 GB 限制",
    "The backup exceeds the 1 GB limit."
  ],
  [
    "请选择远端目标路径",
    "Choose a remote destination path."
  ],
  [
    "备份失败，请检查存储空间与远端连接",
    "Backup failed. Check storage space and the remote connection."
  ],
  [
    "备份不存在",
    "Backup not found."
  ],
  [
    "备份文件尚未生成",
    "The backup file has not been created yet."
  ],
  [
    "不能删除正在运行的任务",
    "Wait for the task to finish before deleting it."
  ],
  [
    "备份文件最大 1 GB",
    "The maximum backup file size is 1 GB."
  ],
  [
    "密码",
    "Password"
  ],
  [
    "备份文件无法解密",
    "Could not decrypt the backup."
  ],
  [
    "备份目录缺失或过大",
    "The backup directory is missing or too large."
  ],
  [
    "备份校验失败，未恢复内容",
    "Backup validation failed. No content was restored."
  ],
  [
    "请先预览此备份，再确认恢复",
    "Preview this backup before confirming the restore."
  ],
  [
    "备份记录映射失败",
    "Could not map the backup records."
  ],
  [
    "备份中的媒体文件格式无效",
    "The backup contains an invalid media file format."
  ],
  [
    "备份头像不是图片",
    "The backup avatar must be an image."
  ],
  [
    "{0}（恢复副本）",
    "{0} (restored copy)"
  ],
  [
    "备份缺少头像文件，请选择包含文件的完整备份",
    "The backup is missing avatar files. Choose a full backup that includes files."
  ],
  [
    "恢复未完成，已移除本次新建内容",
    "Restore did not complete. Content created by this attempt has been removed."
  ],
  [
    "备份时间无效",
    "Invalid backup time."
  ],
  [
    "请填写远端保存路径",
    "Enter a remote save path."
  ],
  [
    "服务重启导致任务中断，请重新操作",
    "A service restart interrupted the task. Start it again."
  ],
  [
    "请选择有效的备份内容",
    "Choose valid backup content."
  ],
  [
    "不支持的备份格式",
    "Unsupported backup format."
  ],
  [
    "备份目录无效",
    "Invalid backup directory."
  ],
  [
    "备份包含无效或重复记录",
    "The backup contains invalid or duplicate records."
  ],
  [
    "备份文件编号无效",
    "Invalid backup file ID."
  ],
  [
    "备份文件内容缺失或大小不符",
    "Backup file content is missing or its size does not match."
  ],
  [
    "文件夹层级无效",
    "Invalid folder hierarchy."
  ],
  [
    "所选内容引用了{0}，请同时选择这些内容",
    "The selected content references {0}. Include it in your selection."
  ],
  [
    "关联的{0}缺失，请先清理失效引用再备份",
    "Linked {0} is missing. Remove invalid references before backing up."
  ],
  [
    "连接目标不匹配",
    "The connection destination does not match."
  ],
  [
    "任务已停止",
    "Task stopped."
  ],
  [
    "浏览器排队超时，请稍后重试",
    "The browser queue timed out. Try again later."
  ],
  [
    "浏览器正在启动",
    "Starting the browser."
  ],
  [
    "浏览器操作已停止",
    "Browser action stopped."
  ],
  [
    "等待用户交还浏览器已超时",
    "Timed out waiting for you to return browser control."
  ],
  [
    "页面不存在",
    "Page not found."
  ],
  [
    "最多打开 3 个页面",
    "Open up to 3 pages."
  ],
  [
    "请先观察页面，再选择元素编号",
    "Inspect the page before choosing an element ID."
  ],
  [
    "请在浏览器面板中手动输入密码",
    "Enter the password yourself in the browser panel."
  ],
  [
    "仅用户可直接键入",
    "Only you can type into this field."
  ],
  [
    "按键不允许",
    "This key is not allowed."
  ],
  [
    "滚动距离无效",
    "Invalid scroll distance."
  ],
  [
    "上传文件不存在",
    "Upload file not found."
  ],
  [
    "下载文件超过 20 MB 限制",
    "The download exceeds the 20 MB limit."
  ],
  [
    "浏览器操作无效",
    "Invalid browser action."
  ],
  [
    "目标元素已变化，请重新观察",
    "The target element has changed. Inspect the page again."
  ],
  [
    "（密码已填写）",
    "(Password entered)"
  ],
  [
    "确认期间网页或目标内容发生变化，操作已停止，请重新确认",
    "The page or target changed during confirmation. The action was stopped. Confirm again."
  ],
  [
    "请先停止当前回复，再删除对话",
    "Stop the current reply before deleting the conversation."
  ],
  [
    "请先停止当前回复，再修改对话内容",
    "Stop the current reply before editing the conversation."
  ],
  [
    "请通过消息操作修改此对话，避免覆盖已保存的回复",
    "Use the message actions to edit this conversation and preserve saved replies."
  ],
  [
    "删除消息参数无效",
    "Invalid message deletion parameters."
  ],
  [
    "消息不存在",
    "Message not found."
  ],
  [
    "模型返回的 token 用量不完整",
    "The model returned incomplete token usage."
  ],
  [
    "模型用量记录不完整",
    "The model usage record is incomplete."
  ],
  [
    "聊天输入 token 预估超出安全范围",
    "The estimated input token count exceeds the safe range."
  ],
  [
    "该用户仍有正在执行的模型请求，请等待请求完成后再删除",
    "Wait for this user's model requests to finish before deleting the account."
  ],
  [
    "{0} 必须是非负有限数字",
    "{0} must be a finite, non-negative number."
  ],
  [
    "{0} 必须是非负整数",
    "{0} must be a non-negative integer."
  ],
  [
    "缺少完整计费设置",
    "The billing settings are incomplete."
  ],
  [
    "usdToCny 必须大于 0",
    "usdToCny must be greater than 0."
  ],
  [
    "缺少完整费率表",
    "The rate table is incomplete."
  ],
  [
    "计费设置版本无效",
    "Invalid billing settings version."
  ],
  [
    "计费日期无效",
    "Invalid billing date."
  ],
  [
    "model 必须是非空字符串",
    "model must be a non-empty string."
  ]
];
export default coreSystemMessages;
