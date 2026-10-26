const messagePairs = [
  [
    "当前对话已被其他请求更新，请重试",
    "This conversation was updated by another request. Please try again."
  ],
  [
    "本次请求已经处理完成，请勿重复提交",
    "This request has already finished. Please avoid submitting it again."
  ],
  [
    "本次请求已在处理中，请勿重复提交",
    "This request is already being processed. Please avoid submitting it again."
  ],
  [
    "聊天费用记录失败",
    "Chat cost recording failed"
  ],
  [
    "本地准备失败后无法结束费用记录",
    "The cost record could not be closed after local preparation failed"
  ],
  [
    "上游模型请求已发出，但没有取得完整用量",
    "The model request was sent, but complete usage data was not received"
  ],
  [
    "无法计算完整用量",
    "Complete usage could not be calculated"
  ],
  [
    "用户中断了聊天请求",
    "The user stopped the chat request"
  ],
  [
    "聊天执行失败",
    "Chat execution failed"
  ],
  [
    "费用记录失败",
    "Cost recording failed"
  ],
  [
    "发送消息失败",
    "The message could not be sent"
  ],
  [
    "上传过于频繁，请稍后再试",
    "Uploads are too frequent. Please try again later."
  ],
  [
    "缺少上传文件",
    "Choose a file to upload"
  ],
  [
    "上传用途不合法",
    "The upload purpose is invalid"
  ],
  [
    "不支持该文件类型",
    "This file type is not supported"
  ],
  [
    "当前用途不支持文档",
    "Documents are not supported for this purpose"
  ],
  [
    "文件大小不能超过 {0}MB",
    "The file must be no larger than {0} MB"
  ],
  [
    "头像仅支持图片文件",
    "Avatars must be image files"
  ],
  [
    "请选择图片或文档文件",
    "Choose an image or document file"
  ],
  [
    "文件上传失败",
    "File upload failed"
  ],
  [
    "第 {0} 张生成失败：{1}",
    "Image {0} failed to generate: {1}"
  ],
  [
    "聊天图片费用记录未完成",
    "Chat image cost recording is incomplete"
  ],
  [
    "聊天图片费用记录失败",
    "Chat image cost recording failed"
  ],
  [
    "用量、任务状态和工具名称；不包含对话正文、输入参数、工具返回内容和凭据。",
    "Usage, task status, and tool names; excludes conversation text, input arguments, tool responses, and credentials."
  ],
  [
    "所有内容恢复为新副本；只有勾选个人设置时才覆盖对应偏好。",
    "All content is restored as new copies. Preferences are overwritten only when personal settings are selected."
  ],
  [
    "定时备份失败，请检查密码配置、存储空间与远端连接",
    "Scheduled backup failed. Check the password settings, storage space, and remote connection."
  ],
  [
    "需要人工复核",
    "Manual review required"
  ],
  [
    "头像文件，请在个人资料或助手设置中更换或移除头像",
    "Avatar file. Replace or remove the avatar in your profile or assistant settings."
  ],
  [
    "图片生成文件，请在图片生成页面删除对应记录",
    "Generated image file. Delete its record on the image generation page."
  ],
  [
    "语音生成文件，请在语音生成页面删除对应记录",
    "Generated audio file. Delete its record on the audio generation page."
  ],
  [
    "已保存 {0}",
    "Saved {0}"
  ],
  [
    "写回 {0}",
    "Write back to {0}"
  ],
  [
    "请检查输入内容和对话长度后重试",
    "Check your input and conversation length, then try again"
  ],
  [
    "暂时无法连接对话服务，请稍后再试",
    "The chat service is temporarily unreachable. Please try again later."
  ],
  [
    "用户删除任务已由其他请求接管",
    "Another request has taken over this user deletion task"
  ],
  [
    "没有提供需要读取的网页地址",
    "No web page URL was provided"
  ],
  [
    "只能读取本轮搜索结果中出现的网页地址",
    "Only URLs from this round of search results can be read"
  ],
  [
    "页面抓取全部失败（共 {0} 页）",
    "All page requests failed ({0} pages)"
  ],
  [
    "文档解析超过 30 秒，请拆分文档后上传",
    "Document processing took more than 30 seconds. Split the document and upload it again."
  ],
  [
    "文档解析失败或内容超过限制，请检查并拆分文档",
    "Document processing failed or the content exceeds the limit. Check the document and split it into smaller files."
  ],
  [
    "文档解析已中止",
    "Document processing was cancelled"
  ],
  [
    "管理员尚未配置完整参数",
    "An admin has not finished configuring the required parameters"
  ],
  [
    "服务器尚未配置此媒体服务",
    "This media service has not been configured on the server"
  ],
  [
    "管理员尚未启用图片生成",
    "An admin has not enabled image generation"
  ],
  [
    "管理员尚未启用配音服务",
    "An admin has not enabled the speech service"
  ],
  [
    "服务重启中断工作台任务，需要核查本轮模型用量",
    "A server restart interrupted the task. This round’s model usage needs to be checked."
  ],
  [
    "本轮消耗 ¥{0}",
    "Cost this round: ¥{0}"
  ],
  [
    "工作台模型请求已发出，但未完成用量结算",
    "The task’s model request was sent, but usage settlement is incomplete"
  ],
  [
    "结果已截断，请缩小查询范围。",
    "The results were truncated. Narrow your query."
  ],
  [
    "此预览被截断，使用read_task_step查询记录；文档请使用read_document分页读取。",
    "This preview was truncated. Use read_task_step to view the record, or read_document to read documents in pages."
  ],
  [
    "外部操作失败，请检查连接或操作目标",
    "The external action failed. Check the connection or destination."
  ],
  [
    "你拒绝了本次操作，未执行提交",
    "You declined this action, so nothing was submitted"
  ],
  [
    "确认超过5分钟，未执行提交",
    "The 5-minute approval period expired, so nothing was submitted"
  ],
  [
    "外部服务没有返回明确结果，已停止且未重试",
    "The external service returned an uncertain result. The action was stopped without retrying."
  ],
  [
    "确认期间操作目标发生变化，未执行提交",
    "The destination changed during approval, so nothing was submitted"
  ],
  [
    "工具未能完成，请检查输入资料、目标和连接权限",
    "The tool could not finish. Check the input, destination, and connection permissions."
  ],
  [
    "联网服务返回的数据格式无效",
    "The web service returned data in an invalid format"
  ],
  [
    "联网请求已取消",
    "The web request was cancelled"
  ],
  [
    "联网请求超时",
    "The web request timed out"
  ],
  [
    "无法连接联网服务",
    "The web service could not be reached"
  ],
  [
    "联网请求参数无效",
    "The web request parameters are invalid"
  ],
  [
    "联网服务密钥无效，请联系管理员",
    "The web service key is invalid. Contact an admin."
  ],
  [
    "当前账号尚未开通联网搜索权限，请联系管理员",
    "Web search access has not been enabled for this account. Contact an admin."
  ],
  [
    "联网服务拒绝访问",
    "The web service denied access"
  ],
  [
    "联网服务接口不可用",
    "The web service endpoint is unavailable"
  ],
  [
    "联网请求过于频繁，请稍后再试",
    "Web requests are too frequent. Please try again later."
  ],
  [
    "联网服务请求失败",
    "The web service request failed"
  ],
  [
    "网页内容过大，无法读取",
    "The web page is too large to read"
  ],
  [
    "网页地址不允许访问",
    "Access to this web page URL is blocked"
  ],
  [
    "网页跳转后的地址不允许访问",
    "Access to the redirected web page URL is blocked"
  ],
  [
    "文件内容与 WAV 格式不符",
    "The file content does not match the WAV format"
  ],
  [
    "WAV 文件长度信息不正确，文件可能已损坏",
    "The WAV file length is incorrect. The file may be damaged."
  ],
  [
    "WAV 文件区块信息不完整",
    "The WAV chunk information is incomplete"
  ],
  [
    "WAV 文件区块长度不正确",
    "The WAV chunk length is incorrect"
  ],
  [
    "WAV 文件包含重复的音频格式区块",
    "The WAV file contains duplicate audio format chunks"
  ],
  [
    "WAV 音频格式信息不完整",
    "The WAV audio format information is incomplete"
  ],
  [
    "WAV 扩展格式信息不完整",
    "The WAV extended format information is incomplete"
  ],
  [
    "WAV 音频必须使用 16 位 PCM 编码",
    "WAV audio must use 16-bit PCM encoding"
  ],
  [
    "WAV 音频格式参数不正确",
    "The WAV audio format parameters are incorrect"
  ],
  [
    "WAV 文件区块填充不完整",
    "The WAV chunk padding is incomplete"
  ],
  [
    "WAV 文件结构不完整",
    "The WAV file structure is incomplete"
  ],
  [
    "WAV 文件缺少音频格式信息",
    "The WAV file is missing audio format information"
  ],
  [
    "WAV 文件必须包含一个有效的音频数据区块",
    "The WAV file must contain one valid audio data chunk"
  ],
  [
    "WAV 音频数据与声道信息不匹配",
    "The WAV audio data does not match its channel information"
  ],
  [
    "MP3 的 ID3 标签信息不完整",
    "The MP3 ID3 tag information is incomplete"
  ],
  [
    "MP3 的 ID3 标签长度信息不正确",
    "The MP3 ID3 tag length is incorrect"
  ],
  [
    "MP3 的 ID3 标签版本无效",
    "The MP3 ID3 tag version is invalid"
  ],
  [
    "MP3 的 ID3 标签长度超过文件范围",
    "The MP3 ID3 tag extends beyond the file"
  ],
  [
    "MP3 的 ID3 标签尾部信息不正确",
    "The MP3 ID3 tag footer is incorrect"
  ],
  [
    "MP3 音频帧信息不完整",
    "The MP3 audio frame information is incomplete"
  ],
  [
    "MP3 音频帧同步信息无效",
    "The MP3 audio frame synchronization is invalid"
  ],
  [
    "MP3 音频必须使用有效的 Layer III 编码",
    "MP3 audio must use valid Layer III encoding"
  ],
  [
    "MP3 音频帧的码率或采样率信息无效",
    "The MP3 audio frame bitrate or sample rate is invalid"
  ],
  [
    "MP3 音频帧参数无效",
    "The MP3 audio frame parameters are invalid"
  ],
  [
    "MP3 音频帧长度无效",
    "The MP3 audio frame length is invalid"
  ],
  [
    "文件内容与 MP3 格式不符",
    "The file content does not match the MP3 format"
  ],
  [
    "MP3 音频帧长度超过文件范围",
    "The MP3 audio frame extends beyond the file"
  ],
  [
    "MP3 音频流中的采样率或声道信息不一致",
    "The MP3 audio stream contains inconsistent sample rates or channel information"
  ],
  [
    "文件中没有连续有效的 MP3 音频帧",
    "The file has no continuous sequence of valid MP3 audio frames"
  ],
  [
    "M4A 文件区块信息不完整",
    "The M4A box information is incomplete"
  ],
  [
    "M4A 文件区块长度无效",
    "The M4A box length is invalid"
  ],
  [
    "M4A 文件区块长度超过文件范围",
    "The M4A box extends beyond the file"
  ],
  [
    "M4A 文件结构不完整",
    "The M4A file structure is incomplete"
  ],
  [
    "M4A 文件缺少有效的{0}时间信息",
    "The M4A file is missing valid {0} timing information"
  ],
  [
    "M4A 文件的{0}时间信息不完整",
    "The M4A file has incomplete {0} timing information"
  ],
  [
    "M4A 文件的{0}时长信息无效",
    "The M4A file has invalid {0} duration information"
  ],
  [
    "M4A 文件的{0}时间版本不受支持",
    "The M4A file uses an unsupported {0} timing version"
  ],
  [
    "M4A 文件的{0}时间基准无效",
    "The M4A file has an invalid {0} time base"
  ],
  [
    "M4A 的音频编码描述不完整",
    "The M4A audio codec description is incomplete"
  ],
  [
    "M4A 的音频编码描述长度不完整",
    "The M4A audio codec description length is incomplete"
  ],
  [
    "M4A 的音频编码描述长度无效",
    "The M4A audio codec description length is invalid"
  ],
  [
    "M4A 的 AAC 音频描述不完整",
    "The M4A AAC audio description is incomplete"
  ],
  [
    "M4A 的 AAC 地址描述不完整",
    "The M4A AAC address description is incomplete"
  ],
  [
    "M4A 的 AAC 音频描述长度无效",
    "The M4A AAC audio description length is invalid"
  ],
  [
    "M4A 的 AAC 编码参数不完整",
    "The M4A AAC encoding parameters are incomplete"
  ],
  [
    "M4A 的 AAC 采样率参数无效",
    "The M4A AAC sample rate parameter is invalid"
  ],
  [
    "M4A 的 AAC 编码参数无效",
    "The M4A AAC encoding parameters are invalid"
  ],
  [
    "M4A 的 AAC 编码描述无效",
    "The M4A AAC encoding description is invalid"
  ],
  [
    "M4A 文件缺少 AAC 解码参数",
    "The M4A file is missing AAC decoding parameters"
  ],
  [
    "M4A 音频必须使用 AAC 或 ALAC 编码",
    "M4A audio must use AAC or ALAC encoding"
  ],
  [
    "M4A 文件缺少 AAC 采样参数",
    "The M4A file is missing AAC sampling parameters"
  ],
  [
    "M4A 的 ALAC 编码参数不完整",
    "The M4A ALAC encoding parameters are incomplete"
  ],
  [
    "M4A 的 ALAC 编码参数无效",
    "The M4A ALAC encoding parameters are invalid"
  ],
  [
    "M4A 的音频轨道参数不完整",
    "The M4A audio track parameters are incomplete"
  ],
  [
    "M4A 的音频轨道版本不受支持",
    "The M4A audio track version is not supported"
  ],
  [
    "M4A 的音频轨道参数无效",
    "The M4A audio track parameters are invalid"
  ],
  [
    "M4A 文件缺少 AAC 编码信息",
    "The M4A file is missing AAC encoding information"
  ],
  [
    "M4A 音频轨道的声道信息不一致",
    "The M4A audio track has inconsistent channel information"
  ],
  [
    "M4A 音频轨道的采样率信息不一致",
    "The M4A audio track has inconsistent sample rate information"
  ],
  [
    "M4A 文件缺少 ALAC 编码信息",
    "The M4A file is missing ALAC encoding information"
  ],
  [
    "M4A 音频轨道的 ALAC 参数不一致",
    "The M4A audio track has inconsistent ALAC parameters"
  ],
  [
    "M4A 的音频采样描述无效",
    "The M4A audio sample description is invalid"
  ],
  [
    "M4A 的音频采样描述数量无效",
    "The M4A audio sample description count is invalid"
  ],
  [
    "M4A 的音频采样描述长度不一致",
    "The M4A audio sample description lengths are inconsistent"
  ],
  [
    "M4A 文件中没有可用的 AAC 或 ALAC 音频轨道",
    "The M4A file has no usable AAC or ALAC audio track"
  ],
  [
    "M4A 文件缺少轨道类型信息",
    "The M4A file is missing track type information"
  ],
  [
    "M4A 文件缺少音频媒体信息",
    "The M4A file is missing audio media information"
  ],
  [
    "M4A 文件缺少音频采样表",
    "The M4A file is missing an audio sample table"
  ],
  [
    "M4A 文件缺少音频采样描述",
    "The M4A file is missing an audio sample description"
  ],
  [
    "文件内容与 M4A 格式不符",
    "The file content does not match the M4A format"
  ],
  [
    "M4A 文件品牌信息不完整",
    "The M4A file brand information is incomplete"
  ],
  [
    "M4A 文件品牌信息无效",
    "The M4A file brand information is invalid"
  ],
  [
    "M4A 文件缺少媒体信息或音频数据",
    "The M4A file is missing media information or audio data"
  ],
  [
    "M4A 文件中没有媒体轨道",
    "The M4A file has no media tracks"
  ],
  [
    "M4A 音频文件不能包含视频轨道",
    "M4A audio files must not contain video tracks"
  ],
  [
    "M4A 文件只能包含一条音频轨道",
    "M4A files must contain exactly one audio track"
  ],
  [
    "M4A 文件中没有可读取的音频轨道",
    "The M4A file has no readable audio track"
  ],
  [
    "文件内容与 OGG 格式不符",
    "The file content does not match the OGG format"
  ],
  [
    "OGG 音频分页结构无效",
    "The OGG audio page structure is invalid"
  ],
  [
    "OGG 音频版本不受支持",
    "The OGG audio version is not supported"
  ],
  [
    "OGG 音频分页信息不完整",
    "The OGG audio page information is incomplete"
  ],
  [
    "OGG 音频分页长度无效",
    "The OGG audio page length is invalid"
  ],
  [
    "OGG 音频必须使用有效的 Opus 编码",
    "OGG audio must use valid Opus encoding"
  ],
  [
    "OGG Opus 音频声道信息无效",
    "The OGG Opus channel information is invalid"
  ],
  [
    "OGG 音频不能包含多个逻辑音频流",
    "OGG audio must not contain multiple logical audio streams"
  ],
  [
    "OGG Opus 音频内容不完整",
    "The OGG Opus audio content is incomplete"
  ],
  [
    "OGG Opus 音频时长无效",
    "The OGG Opus audio duration is invalid"
  ],
  [
    "OGG Opus 音频没有有效内容",
    "The OGG Opus audio has no valid content"
  ],
  [
    "音频信息过多，无法处理",
    "The audio metadata is too large to process"
  ],
  [
    "音频处理超时，请缩短素材后重试",
    "Audio processing timed out. Shorten the recording and try again."
  ],
  [
    "音频转码服务暂时不可用",
    "The audio transcoding service is temporarily unavailable"
  ],
  [
    "无法读取音频，请确认文件未损坏",
    "The audio could not be read. Check that the file is intact."
  ],
  [
    "音频内容损坏或无法完整解码",
    "The audio is damaged or could not be fully decoded"
  ],
  [
    "本次媒体请求已经处理完成，请勿重复提交",
    "This media request has already finished. Please avoid submitting it again."
  ],
  [
    "本次媒体请求已在处理中，请勿重复提交",
    "This media request is already being processed. Please avoid submitting it again."
  ],
  [
    "Fish Audio 未接受本次参数，请检查文字和音色",
    "Fish Audio rejected these parameters. Check the text and voice."
  ],
  [
    "Fish Audio 服务密钥无效",
    "The Fish Audio service key is invalid"
  ],
  [
    "Fish Audio 服务账户余额不足",
    "The Fish Audio service account has insufficient funds"
  ],
  [
    "Fish Audio 服务账户权限不足",
    "The Fish Audio service account lacks the required permissions"
  ],
  [
    "该 Fish Audio 音色已被删除",
    "This Fish Audio voice has been deleted"
  ],
  [
    "Fish Audio 当前请求较多，请稍后再试",
    "Fish Audio is handling many requests. Please try again later."
  ],
  [
    "图片请求存在未能确认的结果，费用待核对",
    "Some image request results are unconfirmed. Costs need to be checked."
  ],
  [
    "图片已生成，费用待核对：{0}",
    "The images were generated. Costs need to be checked: {0}"
  ],
  [
    "图片请求已取消",
    "The image request was cancelled"
  ],
  [
    "Micu 图片服务请求超时，请稍后再试",
    "The Micu image service request timed out. Please try again later."
  ],
  [
    "账号正在删除，暂时无法执行此操作",
    "The account is being deleted. This action is temporarily unavailable."
  ],
  [
    "暂时无法开始媒体操作",
    "The media operation could not be started right now"
  ],
  [
    "媒体操作租约无效",
    "The media operation lease is invalid"
  ],
  [
    "媒体操作已失效，未保存本次结果",
    "The media operation expired, so its result was not saved"
  ],
  [
    "已有一个声音复刻正在创建，请等待完成后再试",
    "A voice is already being cloned. Wait for it to finish and try again."
  ],
  [
    "声音复刻创建租约无效",
    "The voice creation lease is invalid"
  ],
  [
    "该用户正在被删除，请稍后再试",
    "This user is being deleted. Please try again later."
  ],
  [
    "用户删除租约无效",
    "The user deletion lease is invalid"
  ],
  [
    "仍有媒体操作正在完成，账号已保持删除中，请稍后重试删除",
    "Media operations are finishing. The account remains marked for deletion. Try deleting it again later."
  ],
  [
    "读取视频时长超时",
    "Reading the video duration timed out"
  ],
  [
    "Fish Audio 已返回音频，费用结算待核实",
    "Fish Audio returned audio. The cost settlement needs to be verified."
  ],
  [
    "Fish Audio 请求已发出，生成结果待核实",
    "The Fish Audio request was sent. The generation result needs to be verified."
  ],
  [
    "语音费用记录失败",
    "Audio cost recording failed"
  ],
  [
    "图片费用记录未完成",
    "Image cost recording is incomplete"
  ],
  [
    "图片费用记录失败",
    "Image cost recording failed"
  ],
  [
    "{0} 参数须在 {1} 到 {2} 之间",
    "{0} must be between {1} and {2}"
  ],
  [
    "请求内容格式错误",
    "The request content format is invalid"
  ],
  [
    "请输入需要朗读的文字",
    "Enter the text to read aloud"
  ],
  [
    "朗读文字最多 {0} 个字符",
    "The text can contain up to {0} characters"
  ],
  [
    "请选择有效音色",
    "Choose a valid voice"
  ],
  [
    "请选择 Fish Audio S2.1 Pro 模型",
    "Choose the Fish Audio S2.1 Pro model"
  ],
  [
    "请选择 MP3 或 WAV 音频格式",
    "Choose MP3 or WAV audio format"
  ],
  [
    "请选择与音频格式匹配的采样率",
    "Choose a sample rate that matches the audio format"
  ],
  [
    "编号无效",
    "Invalid id"
  ],
  [
    "内容不存在",
    "Not found"
  ],
  [
    "请输入提示内容",
    "Prompt is required"
  ],
  [
    "对话历史需要使用数组",
    "history must be an array"
  ],
  [
    "数据库连接失败",
    "Database connection failed"
  ],
  [
    "联网搜索设置无效",
    "webSearch invalid"
  ],
  [
    "联网搜索开关设置无效",
    "webSearch.enabled invalid"
  ],
  [
    "消息内容格式无效",
    "messages invalid"
  ],
  [
    "消息列表需要使用数组",
    "messages must be an array"
  ],
  [
    "消息数量超过上限（最多 {0} 条）",
    "messages too many (max {0})"
  ],
  [
    "第 {0} 条消息格式无效",
    "messages[{0}] invalid"
  ],
  [
    "第 {0} 条消息正文过长",
    "messages[{0}].content too long"
  ],
  [
    "第 {0} 条消息的思考内容过长",
    "messages[{0}].thought too long"
  ],
  [
    "第 {0} 条消息的内容片段过多",
    "messages[{0}].parts too many"
  ],
  [
    "第 {0} 条消息中第 {1} 个片段的文字过长",
    "messages[{0}].parts[{1}].text too long"
  ],
  [
    "第 {0} 条消息中第 {1} 个片段的图片无效",
    "messages[{0}].parts[{1}].image invalid"
  ],
  [
    "第 {0} 条消息中第 {1} 个片段的文件无效",
    "messages[{0}].parts[{1}].file invalid"
  ],
  [
    "第 {0} 条消息中第 {1} 个片段的文件名无效",
    "messages[{0}].parts[{1}].file name invalid"
  ],
  [
    "第 {0} 条消息中第 {1} 个片段的文件类型无效",
    "messages[{0}].parts[{1}].file mimeType invalid"
  ],
  [
    "第 {0} 条消息中第 {1} 个片段的文件扩展名无效",
    "messages[{0}].parts[{1}].file extension invalid"
  ],
  [
    "第 {0} 条消息中第 {1} 个片段的文件分类无效",
    "messages[{0}].parts[{1}].file category invalid"
  ],
  [
    "第 {0} 条消息中第 {1} 个片段的文件大小无效",
    "messages[{0}].parts[{1}].file size invalid"
  ],
  [
    "消息文字总量超过上限",
    "messages total text too large"
  ],
  [
    "服务器内部错误",
    "Internal Server Error"
  ],
  [
    "请求中的 JSON 格式无效",
    "Invalid JSON in request body"
  ],
  [
    "消息修改内容无效",
    "Invalid message patch"
  ],
  [
    "{0} 的数量超过上限",
    "{0} too many"
  ],
  [
    "{0} 中第 {1} 项的编号无效",
    "{0}[{1}].id invalid"
  ],
  [
    "{0} 中第 {1} 项的标识无效",
    "{0}[{1}].identifier invalid"
  ],
  [
    "{0} 中第 {1} 项的接口名称无效",
    "{0}[{1}].apiName invalid"
  ],
  [
    "{0} 需要使用数组",
    "{0} must be an array"
  ],
  [
    "第 {0} 条消息需要使用对象格式",
    "messages[{0}] must be an object"
  ],
  [
    "第 {0} 条消息的角色无效",
    "messages[{0}].role invalid"
  ],
  [
    "第 {0} 条消息的类型无效",
    "messages[{0}].type invalid"
  ],
  [
    "第 {0} 条消息的编号无效",
    "messages[{0}].id invalid"
  ],
  [
    "第 {0} 条消息缺少内容片段",
    "messages[{0}].parts required"
  ],
  [
    "第 {0} 条消息的片段文字过长",
    "messages[{0}].parts text too long"
  ],
  [
    "第 {0} 条消息的片段图片无效",
    "messages[{0}].parts image invalid"
  ],
  [
    "第 {0} 条消息的片段图片类型无效",
    "messages[{0}].parts image mimeType invalid"
  ],
  [
    "第 {0} 条消息的片段文件无效",
    "messages[{0}].parts file invalid"
  ],
  [
    "第 {0} 条消息的片段文件名无效",
    "messages[{0}].parts file name invalid"
  ],
  [
    "第 {0} 条消息的片段文件类型无效",
    "messages[{0}].parts file mimeType invalid"
  ],
  [
    "第 {0} 条消息的片段文件扩展名无效",
    "messages[{0}].parts file extension invalid"
  ],
  [
    "第 {0} 条消息的片段文件分类无效",
    "messages[{0}].parts file category invalid"
  ],
  [
    "第 {0} 条消息的片段文件大小无效",
    "messages[{0}].parts file size invalid"
  ],
  [
    "第 {0} 条消息的内容片段无效",
    "messages[{0}].parts invalid"
  ],
  [
    "请求内容格式无效",
    "Invalid request body"
  ],
  [
    "请求中包含未支持的字段",
    "Unsupported field in request body"
  ],
  [
    "置顶设置需要使用开关值",
    "pinned must be a boolean"
  ],
  [
    "设置内容需要使用对象格式",
    "settings must be an object"
  ],
  [
    "标题过长",
    "title too long"
  ],
  [
    "模型无效",
    "model invalid"
  ],
  [
    "第 {0} 个对话的联网搜索设置无效",
    "conversations[{0}].settings.webSearch invalid"
  ],
  [
    "第 {0} 个对话需要使用对象格式",
    "conversations[{0}] must be an object"
  ],
  [
    "第 {0} 个对话的标题过长",
    "conversations[{0}].title too long"
  ],
  [
    "第 {0} 个对话的模型名称过长",
    "conversations[{0}].model too long"
  ],
  [
    "第 {0} 个对话的模型无效",
    "conversations[{0}].model invalid"
  ],
  [
    "消息编号无效",
    "messageId invalid"
  ],
  [
    "{0} 协议的对话状态无效",
    "providerState.{0} invalid"
  ],
  [
    "搜索失败",
    "Search failed"
  ],
  [
    "抓取网页时发生未知错误",
    "Unknown crawl error"
  ],
  [
    "文件仍被对话、任务或头像使用，请先移除对应引用",
    "This file is used by a conversation, task, or avatar. Remove those references first."
  ],
  [
    "相关任务正在运行，请结束后再删除",
    "A related task is running. Wait for it to finish before deleting the file."
  ],
  [
    "“{0}”：{1}",
    "“{0}”: {1}"
  ],
  [
    "第 {0} 张：{1}",
    "Image {0}: {1}"
  ],
  [
    "已整理表格并生成 {0}",
    "Processed the spreadsheet and created {0}"
  ],
  [
    "文档文字超过 200 万字，请拆分后上传",
    "The document exceeds 2 million characters. Split it before uploading."
  ],
  [
    "文档内容块过多，请拆分后上传",
    "The document contains too many content sections. Split it before uploading."
  ],
  [
    "文本文件必须为 UTF-8 编码，且不能包含二进制内容",
    "Text files must use UTF-8 encoding and contain no binary content"
  ],
  [
    "表格最多支持 20 万个单元格，请拆分后上传",
    "Spreadsheets can contain up to 200,000 cells. Split the file before uploading."
  ],
  [
    "PDF 文件格式不正确",
    "The PDF file format is invalid"
  ],
  [
    "PDF 最多支持 300 页，请拆分后上传",
    "PDFs can contain up to 300 pages. Split the file before uploading."
  ],
  [
    "工作表不能超过 100 个",
    "A workbook can contain up to 100 worksheets"
  ],
  [
    "工作表最多支持 5 万行、200 列",
    "Each worksheet can contain up to 50,000 rows and 200 columns"
  ],
  [
    "表格公式没有可读取的计算结果，请在 Excel 中计算并保存后上传",
    "A spreadsheet formula has no readable result. Calculate and save the file in Excel before uploading."
  ],
  [
    "CSV 最多支持 5 万行",
    "CSV files can contain up to 50,000 rows"
  ],
  [
    "CSV 最多支持 200 列",
    "CSV files can contain up to 200 columns"
  ],
  [
    "暂不支持加密 PDF，请移除密码后上传",
    "Encrypted PDFs are not supported. Remove the password before uploading."
  ],
  [
    "文档无法读取，请检查文件是否损坏或已加密",
    "The document could not be read. Check whether it is damaged or encrypted."
  ],
  [
    "未找到可读取文字，暂不支持扫描版 PDF",
    "No readable text was found. Scanned PDFs are not supported."
  ],
  [
    "文档没有可读取的内容",
    "The document has no readable content"
  ],
  [
    "图片服务返回了空结果",
    "The image service returned an empty result"
  ],
  [
    "图片编辑服务返回了空结果",
    "The image editing service returned an empty result"
  ],
  [
    "请选择支持的图片模型",
    "Choose a supported image model"
  ],
  [
    "图片数量必须是 1 至 4 的整数",
    "Choose a whole number of images from 1 to 4"
  ],
  [
    "请为 {0} 重新选择图片尺寸",
    "Choose a valid image size for {0}"
  ],
  [
    "参考图片列表无效",
    "The reference image list is invalid"
  ],
  [
    "请至少选择一张参考图片",
    "Choose at least one reference image"
  ],
  [
    "{0} 最多可选择 {1} 张参考图片",
    "Choose up to {1} reference images for {0}"
  ],
  [
    "参考图片信息无效，请重新选择图片",
    "The reference image is invalid. Choose the image again."
  ],
  [
    "请将“{0}”转为 {1} 格式后上传至 {2}",
    "Convert “{0}” to {1} before uploading to {2}"
  ],
  [
    "“{0}”超过 {1} MB，请压缩后再上传",
    "“{0}” exceeds {1} MB. Compress it before uploading."
  ],
  [
    "{0} 的参考图片合计最多 {1} MB",
    "Reference images for {0} can total up to {1} MB"
  ],
  [
    "图片生成失败",
    "Image generation failed"
  ],
  [
    "图片编辑失败",
    "Image editing failed"
  ],
  [
    "网络连接失败，请稍后再试",
    "Connection failed. Please try again later."
  ],
  [
    "语音请求失败",
    "The audio request failed"
  ],
  [
    "试听音频为空",
    "The voice preview is empty"
  ],
  [
    "操作失败，请检查配置后重试",
    "The operation failed. Check the settings and try again."
  ],
  [
    "无法读取视频附件时长",
    "The video attachment duration could not be read"
  ],
  [
    "无法读取音频附件时长",
    "The audio attachment duration could not be read"
  ],
  [
    "本次模型用量无法自动核对，费用已标记待核对",
    "This request’s model usage could not be verified automatically. Its costs have been marked for review."
  ],
  [
    "项目名称",
    "Project name"
  ],
  [
    "项目介绍",
    "Project description"
  ],
  [
    "项目指令",
    "Project instructions"
  ],
  [
    "请求内容无效",
    "The request content is invalid"
  ],
  [
    "媒体生成失败",
    "Media generation failed"
  ],
  [
    "文件夹名称",
    "Folder name"
  ],
  [
    "朗读请求格式无效",
    "The read-aloud request format is invalid"
  ],
  [
    "模型连接设置格式无效",
    "The model connection settings format is invalid"
  ],
  [
    "用户已停止任务",
    "The user stopped the task"
  ],
  [
    "地址不允许访问",
    "Access to this address is blocked"
  ],
  [
    "花费记录处理失败",
    "The spending record could not be processed"
  ],
  [
    "远端操作超时，未自动重试",
    "The remote operation timed out and was not retried automatically"
  ],
  [
    "文件或列表超过 20 MB 限制",
    "The file or listing exceeds the 20 MB limit"
  ],
  [
    "远端操作无法启动，请检查服务器 rclone 配置",
    "The remote operation could not start. Check the server’s rclone configuration."
  ],
  [
    "远端操作失败，未自动重试，请检查连接和权限",
    "The remote operation failed and was not retried automatically. Check the connection and permissions."
  ],
  [
    "文件超过大小限制",
    "The file exceeds the size limit"
  ],
  [
    "备份文件内容大小不符",
    "The backup file content does not match its expected size"
  ],
  [
    "文件大小超过允许上限",
    "The file exceeds the maximum allowed size"
  ],
  [
    "请确认外部操作",
    "Review and confirm the external action"
  ],
  [
    "文档损坏或格式不正确",
    "The document is damaged or has an invalid format"
  ],
  [
    "文档损坏、已加密或解压内容超过限制",
    "The document is damaged, encrypted, or exceeds the extraction limit"
  ],
  [
    "开始制作媒体",
    "Media creation started"
  ],
  [
    "正在分析资料并安排下一步",
    "Analyzing the material and planning the next step"
  ],
  [
    "消息",
    "Message"
  ],
  [
    "对话指令",
    "Conversation instructions"
  ],
  [
    "工具参数格式错误",
    "The tool arguments have an invalid format"
  ],
  [
    "搜索内容",
    "Search query"
  ],
  [
    "搜索语言",
    "Search language"
  ],
  [
    "网页不存在或已被删除",
    "The web page was not found or has been deleted"
  ],
  [
    "无法连接目标网页",
    "The target web page could not be reached"
  ],
  [
    "网页读取超时",
    "Reading the web page timed out"
  ],
  [
    "网页禁止自动访问",
    "The web page blocks automated access"
  ],
  [
    "网页需要登录后才能读取",
    "Sign in to the website to read this page"
  ],
  [
    "网页地址",
    "Web page URL"
  ],
  [
    "音频内容为空或无法读取",
    "The audio content is empty or unreadable"
  ],
  [
    "不支持的音频格式",
    "The audio format is not supported"
  ],
  [
    "音频处理已取消",
    "Audio processing was cancelled"
  ],
  [
    "操作已取消",
    "The operation was cancelled"
  ],
  [
    "Micu 图片服务的 API 密钥无效",
    "The Micu image service API key is invalid"
  ],
  [
    "Micu 图片服务尚未开通所选模型权限",
    "The selected model has not been enabled for the Micu image service account"
  ],
  [
    "Micu 图片服务请求过于频繁，请稍后再试",
    "Micu image requests are too frequent. Please try again later."
  ],
  [
    "Micu 图片服务拒绝了本次请求（{0}）",
    "The Micu image service rejected this request ({0})"
  ],
  [
    "Micu 图片服务请求失败（{0}）",
    "The Micu image service request failed ({0})"
  ],
  [
    "有 {0} 个超级管理员邮箱对应多个账号",
    "{0} super admin email addresses are associated with multiple accounts"
  ],
  [
    "有 {0} 个超级管理员邮箱尚未注册",
    "{0} super admin email addresses have not been registered"
  ],
  [
    "账号不可用，无法创建登录会话",
    "This account is unavailable, so a sign-in session could not be created"
  ],
  [
    "请配置 MONGO_URI 数据库地址",
    "Configure the MONGO_URI database URL"
  ],
  [
    "M4A 文件缺少有效的媒体时间信息",
    "The M4A file is missing valid media timing information"
  ],
  [
    "M4A 文件缺少有效的音频轨道时间信息",
    "The M4A file is missing valid audio track timing information"
  ],
  [
    "M4A 文件的媒体时间信息不完整",
    "The M4A file has incomplete media timing information"
  ],
  [
    "M4A 文件的音频轨道时间信息不完整",
    "The M4A file has incomplete audio track timing information"
  ],
  [
    "M4A 文件的媒体时长信息无效",
    "The M4A file has invalid media duration information"
  ],
  [
    "M4A 文件的音频轨道时长信息无效",
    "The M4A file has invalid audio track duration information"
  ],
  [
    "M4A 文件的媒体时间版本不受支持",
    "The M4A file uses an unsupported media timing version"
  ],
  [
    "M4A 文件的音频轨道时间版本不受支持",
    "The M4A file uses an unsupported audio track timing version"
  ],
  [
    "M4A 文件的媒体时间基准无效",
    "The M4A file has an invalid media time base"
  ],
  [
    "M4A 文件的音频轨道时间基准无效",
    "The M4A file has an invalid audio track time base"
  ],
  ["请选择有效的默认语音服务", "Choose a valid default speech service"],
  ["请选择 Qwen 语音服务", "Choose the Qwen speech service"],
  ["请选择有效的 Qwen 音色", "Choose a valid Qwen voice"],
  ["请选择 Qwen Audio 3.1 TTS Plus 模型", "Choose the Qwen Audio 3.1 TTS Plus model"],
  ["请选择有效的 Qwen 采样率", "Choose a valid Qwen sample rate"],
  ["语速须在 0.5 到 2 之间", "Speech speed must be between 0.5 and 2"],
  ["音量须为 0 到 100 的整数", "Volume must be a whole number from 0 to 100"],
  ["请填写阿里云新加坡业务空间的 HTTPS 根地址", "Enter the HTTPS root URL of your Alibaba Cloud Singapore workspace"],
  ["Qwen 音色服务请求失败，请检查密钥、权限和声音样本", "The Qwen voice request failed. Check the API key, permissions, and audio sample."],
  ["Qwen 音色服务返回异常", "The Qwen voice service returned an invalid response"],
  ["Qwen 复刻音色编号无效", "The Qwen cloned voice ID is invalid"],
  ["Qwen 音色状态或所属模型有误", "The Qwen voice status or target model is invalid"],
  ["Qwen 返回了异常音频数据", "Qwen returned invalid audio data"],
  ["Qwen 返回音频超过大小限制", "The Qwen audio exceeds the size limit"],
  ["Qwen 返回的语音任务编号有误", "The Qwen speech task ID does not match"],
  ["Qwen 重复启动语音任务", "Qwen started the speech task more than once"],
  ["Qwen 语音合成失败，请检查文字、音色和账户权限", "Qwen speech synthesis failed. Check the text, voice, and account permissions."],
  ["Qwen 返回的音频或计费用量不完整", "Qwen returned incomplete audio or billing usage"],
  ["Qwen 语音连接失败，请检查新加坡节点密钥和账户权限", "The Qwen speech connection failed. Check the Singapore API key and account permissions."],
  ["Qwen 语音连接提前结束，音频尚未生成完整", "The Qwen speech connection closed before the audio was complete"],
  ["请选择管理员启用的 Qwen 音色", "Choose a Qwen voice enabled by the administrator"],
  ["请上传 10 MB 以内的声音样本", "Upload an audio sample up to 10 MB"],
  ["声音样本时长须在 5 秒到 60 秒之间", "The audio sample must be between 5 and 60 seconds long"],
  ["声音样本采样率须至少为 16 kHz", "The audio sample rate must be at least 16 kHz"],
  ["缺少 Qwen Audio 3.1 TTS Plus 费率", "The Qwen Audio 3.1 TTS Plus rate is missing"],
  ["语音服务已返回音频，费用结算待核实", "The speech service returned audio. The cost settlement needs verification."],
  ["语音服务请求已发出，生成结果待核实", "The speech request was sent. The generation result needs verification."],
  ["授权未完成，请回到设置重新发起授权", "Authorization was not completed. Return to settings to start again."],
  ["语音记录游标无效", "The audio history cursor is invalid"],
  ["图片记录游标无效", "The image history cursor is invalid"],
  ["图片记录不存在", "The image record was not found"],
  ["外部工具权限已关闭，远端备份上传已停止", "External tools are disabled. The remote backup upload has stopped."],
  ["定时备份状态", "Scheduled backup status"],
  ["定时备份不存在", "The backup schedule was not found"],
  ["定时备份失败，请检查密码配置、存储空间与远端连接", "The scheduled backup failed. Check the password, storage space, and remote connection."],
  ["请管理员在后台配置模型地址、模型和 API Key", "Ask an administrator to configure the model URL, model, and API key."],
  ["“{0}”正被{1}使用，请先到对应对话移除附件或删除引用消息；头像请在设置中移除", "“{0}” is used by {1}. Remove the attachment or its message in the relevant chat first. Remove avatars in settings."],
  ["对话“{0}”", "chat “{0}”"],
  ["保留的任务成果", "saved task results"],
  ["个人资料或助手头像", "a profile or assistant avatar"]
];

export default messagePairs;
