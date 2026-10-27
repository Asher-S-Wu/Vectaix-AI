const taskSystemMessages = [
  [
    "技能文件头必须包含名称与介绍",
    "Skill metadata must include a name and description."
  ],
  [
    "技能名称最多 100 字",
    "Skill names can contain up to 100 characters."
  ],
  [
    "技能介绍最多 2000 字",
    "Skill descriptions can contain up to 2,000 characters."
  ],
  [
    "技能不存在",
    "Skill not found."
  ],
  [
    "技能附件不存在",
    "Skill attachment not found."
  ],
  [
    "仓库中没有找到可安装的技能",
    "No installable skills were found in this repository."
  ],
  [
    "已安装其他来源的同名技能：{0}。请先移除同名技能",
    "A skill named {0} is already installed from another source. Remove it before installing this one."
  ],
  [
    "Skills CLI 未安装指定技能，请核对技能名称",
    "Skills CLI did not install the requested skill. Check the skill name."
  ],
  [
    "技能安装目录缺失，请从原仓库重新安装",
    "The skill installation folder is missing. Reinstall it from the original repository."
  ],
  [
    "请选择技能启用状态",
    "Choose whether to enable this skill."
  ],
  [
    "该技能尚未由管理员启用",
    "An administrator must enable this skill before you can use it."
  ],
  [
    "管理员已停用此技能",
    "An administrator has disabled this skill."
  ],
  [
    "图片内容与扩展名不匹配",
    "The image content does not match its file extension."
  ],
  [
    "文本附件超过 20 万字节，请使用较小的参考文件",
    "The text attachment exceeds 200,000 bytes. Use a smaller reference file."
  ],
  [
    "文本附件必须使用 UTF-8 编码",
    "Text attachments must use UTF-8 encoding."
  ],
  [
    "缺少 STORAGE_ROOT 环境变量",
    "The STORAGE_ROOT environment variable is missing."
  ],
  [
    "媒体文件不存在或无权访问",
    "The media file is missing or you do not have access."
  ],
  [
    "媒体文件类型不匹配",
    "The media file type does not match."
  ],
  [
    "无效的用户文件目录",
    "Invalid user file directory."
  ],
  [
    "非法的存储路径",
    "Invalid storage path."
  ],
  [
    "无效的文件内容",
    "Invalid file content."
  ],
  [
    "文件内容为空",
    "The file is empty."
  ],
  [
    "无效的流式文件内容",
    "Invalid streamed file content."
  ],
  [
    "文件写入已中止",
    "File writing was canceled."
  ],
  [
    "文件提交守卫无效",
    "Invalid file commit guard."
  ],
  [
    "临时文件提交前验证器无效",
    "Invalid temporary file pre-commit validator."
  ],
  [
    "文件缺少存储路径",
    "The file has no storage path."
  ],
  [
    "存储清理时间无效",
    "Invalid storage cleanup time."
  ],
  [
    "请选择有效月份",
    "Choose a valid month."
  ],
  [
    "请选择有效日期",
    "Choose a valid date."
  ],
  [
    "日期范围最多一年",
    "The date range can cover up to one year."
  ],
  [
    "模型名称过长",
    "The model name is too long."
  ],
  [
    "请选择要清理的文件",
    "Select files to delete."
  ],
  [
    "所选文件正在被使用，请先移除对应引用",
    "The selected files are in use. Remove their references first."
  ],
  [
    "该用户仍有工作台任务，请等待任务结束后再删除",
    "This user has active workspace tasks. Wait for them to finish before deleting the account."
  ],
  [
    "该用户仍有备份或恢复任务，请等待任务完成后再删除",
    "This user has active backup or restore tasks. Wait for them to finish before deleting the account."
  ],
  [
    "旧访问空间身份数据清理校验失败",
    "Validation failed when cleaning up legacy space identity data."
  ],
  [
    "朗读文字需要在 1 至 {0} 字之间",
    "Text to read aloud must contain between 1 and {0} characters."
  ],
  [
    "请管理员在后台配置并启用配音服务",
    "Ask an administrator to configure and enable a speech service."
  ],
  [
    "配音服务没有返回音频文件",
    "The speech service did not return an audio file."
  ],
  [
    "页面抓取失败",
    "Could not fetch the webpage."
  ],
  [
    "记录不存在",
    "Record not found."
  ],
  [
    "请求内容格式错误或内容过大",
    "The request content is invalid or too large."
  ],
  [
    "请求内容必须是对象",
    "Request content must be an object."
  ],
  [
    "不能为空，且",
    "must be provided and "
  ],
  [
    "{0}必须是开关值",
    "{0} must be true or false."
  ],
  [
    "操作失败，请稍后再试",
    "The operation failed. Please try again later."
  ],
  [
    "任务不存在",
    "Task not found."
  ],
  [
    "请选择允许或拒绝",
    "Choose Allow or Deny."
  ],
  [
    "确认已失效或已处理",
    "This approval has expired or has already been handled."
  ],
  [
    "待确认文件已失效",
    "The file awaiting approval has expired."
  ],
  [
    "待确认文件不得超过 20 MB",
    "Files awaiting approval can be up to 20 MB."
  ],
  [
    "确认已超时，操作未执行",
    "Approval timed out, so the operation was not performed."
  ],
  [
    "操作未获确认，已取消",
    "The operation was canceled because it was not approved."
  ],
  [
    "确认已使用或失效",
    "This approval has already been used or has expired."
  ],
  [
    "对话资料范围无效",
    "Invalid chat file scope."
  ],
  [
    "请选择当前对话",
    "Select the current chat."
  ],
  [
    "请选择不超过 20MB 的资料文件",
    "Choose a file no larger than 20 MB."
  ],
  [
    "文件名不能为空且最多 200 个字",
    "Enter a filename of up to 200 characters."
  ],
  [
    "支持 PDF、Word、Excel、CSV、文字、图片、音频和视频资料",
    "Supported files include PDF, Word, Excel, CSV, text, images, audio, and video."
  ],
  [
    "当前对话无法读取该文档",
    "This document is unavailable in the current chat."
  ],
  [
    "文档读取参数不正确",
    "Invalid document reading parameters."
  ],
  [
    "请等待当前任务结束后再删除资料",
    "Wait for the current task to finish before deleting files."
  ],
  [
    "当前对话资料不存在",
    "Chat file not found."
  ],
  [
    "请等待项目任务结束后再删除资料",
    "Wait for the project task to finish before deleting files."
  ],
  [
    "项目文件不存在",
    "Project file not found."
  ],
  [
    "表格必须提供 1 至 100 个列名",
    "A table must have between 1 and 100 column names."
  ],
  [
    "表格最多支持 1 万行",
    "Tables can contain up to 10,000 rows."
  ],
  [
    "每行数据的数量必须与列名一致",
    "Each row must have the same number of values as the column headers."
  ],
  [
    "单元格只支持文字、数字、布尔值或空值",
    "Cells can contain text, numbers, true or false, or empty values."
  ],
  [
    "表格内容过长",
    "The table content is too long."
  ],
  [
    "导出支持 Word、Markdown、Excel 和 CSV",
    "You can export to Word, Markdown, Excel, or CSV."
  ],
  [
    "文件名称不正确",
    "Invalid filename."
  ],
  [
    "报告内容不能为空且最多 200 万字",
    "Report content is required and can contain up to 2 million characters."
  ],
  [
    "CSV 不支持以公式符号开头的文字，请改用 Excel 格式",
    "Text beginning with a formula symbol requires Excel format. Choose Excel instead of CSV."
  ],
  [
    "导出文件超过 20MB",
    "The exported file exceeds 20 MB."
  ],
  [
    "导出内容段落过多，请拆分成果",
    "The export has too many paragraphs. Split the content into separate files."
  ],
  [
    "导出表格最多支持 20 万个单元格",
    "Exported tables can contain up to 200,000 cells."
  ],
  [
    "此文件格式不支持文档索引",
    "Document indexing is unavailable for this file format."
  ],
  [
    "任务已不存在",
    "This task no longer exists."
  ],
  [
    "媒体工具缺少调用编号",
    "The media tool is missing a call ID."
  ],
  [
    "素材编号列表无效",
    "Invalid media ID list."
  ],
  [
    "媒体计费记录无效",
    "Invalid media billing record."
  ],
  [
    "媒体计费状态已更新",
    "The media billing status has changed."
  ],
  [
    "媒体结果文件不存在",
    "The generated media file was not found."
  ],
  [
    "请提供结果名称",
    "Enter a name for the result."
  ],
  [
    "该媒体结果的登记未完成，请检查任务记录",
    "This media result has not been fully registered. Check the task history."
  ],
  [
    "请管理员在后台选择图片模型",
    "Ask an administrator to choose an image model."
  ],
  [
    "当前对话无法使用该素材或类型不符",
    "This media is unavailable in the current chat or has the wrong type."
  ],
  [
    "媒体操作已经提交或任务已停止，禁止重复提交",
    "The media operation has already been submitted or the task has stopped. Duplicate submission is blocked."
  ],
  [
    "媒体制作失败",
    "Media generation failed."
  ],
  [
    "计划需要包含 1 到 12 个步骤",
    "A plan must contain between 1 and 12 steps."
  ],
  [
    "计划步骤编号无效或重复",
    "A plan step ID is invalid or duplicated."
  ],
  [
    "计划步骤需要填写 200 字以内的标题",
    "Each plan step needs a title of up to 200 characters."
  ],
  [
    "计划步骤状态无效",
    "Invalid plan step status."
  ],
  [
    "每次集中执行一个计划步骤",
    "Work on one plan step at a time."
  ],
  [
    "任务步骤已达到上限",
    "This task has reached its step limit."
  ],
  [
    "调查目标需要在 1 到 6000 字之间",
    "The research objective must contain between 1 and 6,000 characters."
  ],
  [
    "子助手仅可使用资料读取工具",
    "Sub-assistants can only use tools that read information."
  ],
  [
    "执行已结束，计划中有待完成事项，可继续此任务",
    "This run has ended with unfinished plan items. You can continue the task."
  ],
  [
    "任务执行失败",
    "Task execution failed."
  ],
  [
    "服务重启，任务已中断。已完成的成果保留，不会自动重做。",
    "The service restarted and interrupted this task. Completed results have been kept and will not be regenerated automatically."
  ],
  [
    "表格中不存在列：{0}",
    "Column not found in the table: {0}"
  ],
  [
    "请选择不重复的列名",
    "Choose unique column names."
  ],
  [
    "计算列存在空值或非数字，请先筛选整理",
    "The calculation column contains empty or nonnumeric values. Filter or clean them first."
  ],
  [
    "计算列存在非数字，请先筛选整理",
    "The calculation column contains nonnumeric values. Filter or clean them first."
  ],
  [
    "表格操作包含不支持的参数",
    "The table operation includes unsupported parameters."
  ],
  [
    "请提供 1 至 20 个表格整理操作",
    "Provide between 1 and 20 table operations."
  ],
  [
    "表格操作格式不正确",
    "Invalid table operation format."
  ],
  [
    "筛选条件不支持",
    "Unsupported filter condition."
  ],
  [
    "筛选值必须是文字、数字、布尔值或空值",
    "Filter values must be text, numbers, true or false, or empty values."
  ],
  [
    "排序须指定 asc/desc 及 numeric 开关",
    "Sorting requires asc or desc and a numeric flag."
  ],
  [
    "分组列格式不正确",
    "Invalid grouping column format."
  ],
  [
    "分组须提供 1 至 20 个汇总项",
    "Grouping requires between 1 and 20 aggregations."
  ],
  [
    "汇总项格式不正确",
    "Invalid aggregation format."
  ],
  [
    "汇总仅支持 count/sum，并须指定结果列名 as",
    "Aggregations support count and sum and require an output column name in as."
  ],
  [
    "汇总结果列名不能重复",
    "Aggregation output column names must be unique."
  ],
  [
    "汇总数值超过可处理范围",
    "The aggregated value exceeds the supported range."
  ],
  [
    "支持选列、筛选、排序、去重、分组计数和求和，不支持任意代码",
    "You can select columns, filter, sort, remove duplicates, and group with counts or sums. Arbitrary code cannot be run."
  ],
  [
    "文件和工作表编号不正确",
    "Invalid file or worksheet ID."
  ],
  [
    "该资料没有可整理的 Excel 或 CSV 表格",
    "This file has no Excel or CSV table to process."
  ],
  [
    "工作表不存在，请先查看工作表名称",
    "Worksheet not found. Check the worksheet names first."
  ],
  [
    "表头包含空白或重复列名，请整理源文件后上传",
    "The headers contain empty or duplicate column names. Fix the source file and upload it again."
  ],
  [
    "表格行列数量不一致",
    "The table has inconsistent row or column counts."
  ],
  [
    "请指定工作表和 xlsx/csv 导出格式",
    "Specify a worksheet and choose xlsx or csv as the export format."
  ],
  [
    "上一轮模型用量尚未结算",
    "Model usage from the previous turn is awaiting settlement."
  ],
  [
    "对话资料过多，请减少资料或开启新对话",
    "This chat has too much reference material. Remove some files or start a new chat."
  ],
  [
    "本轮任务已经执行，请勿重复提交",
    "This task turn has already run. Avoid submitting it again."
  ],
  [
    "尚未创建本轮费用记录",
    "A cost record has not yet been created for this turn."
  ],
  [
    "本轮费用记录不存在",
    "Cost record for this turn not found."
  ],
  [
    "模型未返回完整用量，本轮费用需要核查",
    "The model returned incomplete usage data. This turn’s cost needs review."
  ],
  [
    "本轮费用记录需要核查",
    "This turn’s cost record needs review."
  ],
  [
    "请输入消息或上传附件",
    "Enter a message or upload an attachment."
  ],
  [
    "请求编号无效",
    "Invalid request ID."
  ],
  [
    "媒体设置无效",
    "Invalid media settings."
  ],
  [
    "附件无效",
    "Invalid attachment."
  ],
  [
    "请求编号已用于其他消息",
    "This request ID has already been used for another message."
  ],
  [
    "排队消息已达到上限",
    "The message queue is full."
  ],
  [
    "对话所属项目不一致",
    "The chat’s project does not match."
  ],
  [
    "继续任务时请选择原对话",
    "Select the original chat to continue this task."
  ],
  [
    "附件分析",
    "Attachment analysis"
  ],
  [
    "只能继续本对话中已结束的任务",
    "You can only continue a finished task from this chat."
  ],
  [
    "当前对话正在回复，请先停止或等待完成",
    "A reply is in progress. Stop it or wait for it to finish."
  ],
  [
    "附件不存在或不属于当前对话",
    "The attachment is missing or belongs to a different chat."
  ],
  [
    "要编辑的消息不存在",
    "The message to edit was not found."
  ],
  [
    "整理当前任务进度。当资料较多时保存目标、已经确认的事实与来源、产物编号、未完成事项。不要遗漏用户要求。",
    "Review the current task’s progress. When there is a lot of material, save the objective, confirmed facts and sources, artifact IDs, and unfinished work. Preserve all user requirements."
  ],
  [
    "完整但简洁的进度摘要，最多12000字",
    "A complete, concise progress summary of up to 12,000 characters."
  ],
  [
    "进度摘要长度无效",
    "Invalid progress summary length."
  ],
  [
    "只能查看5 MB以内的PNG或JPEG图片",
    "Only PNG or JPEG images up to 5 MB can be viewed."
  ],
  [
    "报告格式无效",
    "Invalid report format."
  ],
  [
    "表格格式无效",
    "Invalid table format."
  ],
  [
    "步骤不存在",
    "Step not found."
  ],
  [
    "步骤分页参数无效",
    "Invalid step pagination parameters."
  ],
  [
    "工具名称重复",
    "Duplicate tool name."
  ],
  [
    "当前工具不可用",
    "This tool is currently unavailable."
  ],
  [
    "工具参数格式无效",
    "Invalid tool parameters."
  ],
  [
    "该工具的使用权限已关闭",
    "Permission to use this tool has been turned off."
  ],
  [
    "当前模型不支持查看图片",
    "The current model cannot view images."
  ],
  [
    "工具返回的图片超过5 MB",
    "The image returned by the tool exceeds 5 MB."
  ],
  [
    "步骤失败：",
    "Step failed:"
  ],
  [
    "工具必须提供对象参数结构",
    "The tool must provide an object parameter schema."
  ],
  [
    "工具参数无效：{0} {1}",
    "Invalid tool parameters: {0} {1}"
  ],
  [
    "无法解析音频，请确认文件格式正确且未损坏",
    "Could not decode the audio. Check the file format and make sure the file is intact."
  ],
  [
    "音频转码服务尚未正确安装",
    "The audio transcoding service is not installed correctly."
  ],
  [
    "当前音频处理任务较多，请稍后再试",
    "Audio processing is busy. Please try again later."
  ],
  [
    "文件内容与 Opus 格式不匹配",
    "The file content does not match Opus format."
  ],
  [
    "文件内容与 AAC 格式不匹配",
    "The file content does not match AAC format."
  ],
  [
    "文件内容与 FLAC 格式不匹配",
    "The file content does not match FLAC format."
  ],
  [
    "无法读取音频信息，请确认文件未损坏",
    "Could not read the audio information. Make sure the file is intact."
  ],
  [
    "文件中没有可用的音频轨道",
    "The file has no usable audio track."
  ],
  [
    "这里只支持音频文件，不能上传视频",
    "Upload an audio file here. Video files are not accepted."
  ],
  [
    "无法读取音频时长，请确认文件未损坏",
    "Could not read the audio duration. Make sure the file is intact."
  ],
  [
    "媒体费用记录必须提供本次估价使用的计费设置",
    "Media cost records must include the billing settings used for this estimate."
  ],
  [
    "幂等请求内容包含无效数字",
    "The idempotent request contains an invalid number."
  ],
  [
    "幂等请求内容包含不支持的值",
    "The idempotent request contains an unsupported value."
  ],
  [
    "缺少有效的媒体操作编号，请重新提交",
    "A valid media operation ID is missing. Submit the request again."
  ],
  [
    "媒体请求标识参数无效",
    "Invalid media request identifier parameters."
  ],
  [
    "ElevenLabs 服务密钥尚未配置",
    "The ElevenLabs service key has not been configured."
  ],
  [
    "ElevenLabs 返回内容超过大小限制",
    "The ElevenLabs response exceeds the size limit."
  ],
  [
    "ElevenLabs 返回了空内容",
    "ElevenLabs returned an empty response."
  ],
  [
    "ElevenLabs 服务请求失败",
    "The ElevenLabs request failed."
  ],
  [
    "ElevenLabs 返回的数据格式有误",
    "ElevenLabs returned an invalid data format."
  ],
  [
    "ElevenLabs 返回了空音频",
    "ElevenLabs returned empty audio."
  ],
  [
    "ElevenLabs 返回内容并非音频",
    "The ElevenLabs response was not audio."
  ],
  [
    "音色编号无效",
    "Invalid voice ID."
  ],
  [
    "ElevenLabs 返回的音色信息有误",
    "ElevenLabs returned invalid voice information."
  ],
  [
    "图片服务尚未配置，请联系管理员",
    "The image service has not been configured. Contact an administrator."
  ],
  [
    "图片处理失败",
    "Image processing failed."
  ],
  [
    "请输入图片描述",
    "Enter an image description."
  ],
  [
    "图片描述最多支持 {0} 个字符",
    "Image descriptions can contain up to {0} characters."
  ],
  [
    "参考图片无效",
    "Invalid reference image."
  ],
  [
    "图片内容与文件格式不一致",
    "The image content does not match the file format."
  ],
  [
    "Micu 图片服务没有返回图片结果",
    "The Micu image service did not return an image."
  ],
  [
    "Micu 图片服务返回的图片编码无效",
    "The Micu image service returned invalid image encoding."
  ],
  [
    "Micu 图片服务返回的内容不是有效的 PNG、JPEG 或 WebP 图片",
    "The Micu image service returned an invalid PNG, JPEG, or WebP image."
  ],
  [
    "Micu 图片服务返回了无法识别的结果",
    "The Micu image service returned an unrecognized result."
  ],
  [
    "暂时无法连接 Micu 图片服务",
    "Could not connect to the Micu image service."
  ],
  [
    "请选择管理员启用的音色",
    "Choose a voice enabled by an administrator."
  ],
  [
    "该音色尚未就绪，请刷新音色状态或选择其他音色",
    "This voice is not ready. Refresh its status or choose another voice."
  ],
  [
    "视频检测服务未安装",
    "The video inspection service is not installed."
  ],
  [
    "视频时长信息格式错误",
    "Invalid video duration format."
  ],
  [
    "无法读取视频时长",
    "Could not read the video duration."
  ],
  [
    "设置内容格式无效",
    "Invalid settings format."
  ],
  [
    "文字最多 {0} 个字",
    "Text can contain up to {0} characters."
  ],
  [
    "存在不支持的设置",
    "The settings include an unsupported option."
  ],
  [
    "权限必须为开关值",
    "Permissions must be true or false."
  ],
  [
    "头像编号无效",
    "Invalid avatar ID."
  ],
  [
    "提示音音量须为 0–100",
    "Sound volume must be between 0 and 100."
  ],
  [
    "所选设置值不受支持",
    "The selected setting value is unsupported."
  ],
  [
    "助手名称不能为空",
    "Enter an assistant name."
  ],
  [
    "SOUL.md 文件过大或无效",
    "The SOUL.md file is invalid or too large."
  ],
  [
    "SOUL.md 须包含名称、语言等文件头信息",
    "SOUL.md must include metadata such as a name and language."
  ],
  ['沙盒设置格式无效', 'Invalid sandbox settings'],
  ['请选择沙盒启用状态', 'Choose whether to enable the sandbox'],
  ['请填写有效的 Railway 环境 ID', 'Enter a valid Railway environment ID'],
  ['单次执行时限需为 10 至 300 秒', 'Each execution must have a time limit between 10 and 300 seconds'],
  ['CPU 请设置为 0.5 至 4 vCPU', 'Set CPU between 0.5 and 4 vCPU'],
  ['内存请设置为 0.5 至 8 GB', 'Set memory between 0.5 and 8 GB'],
  ['初始化命令最多 8000 字符', 'Setup commands can contain up to 8,000 characters'],
  ['启用沙盒前请填写 Railway API Token', 'Enter a Railway API token before enabling the sandbox'],
  ['沙盒操作失败，请检查服务配置后重试', 'Sandbox operation failed. Check the service settings and try again'],
  ['请先保存并启用云端沙盒', 'Save and enable the cloud sandbox first'],
  ['沙盒创建失败，请管理员检查 Railway Token、环境和资源配置', 'Could not create the sandbox. Ask an administrator to check the Railway token, environment, and resources'],
  ['沙盒回收失败，请管理员检查 Railway 中的运行状态', 'Could not remove the sandbox. Ask an administrator to check its status on Railway'],
  ['沙盒已关闭，请开始新任务', 'The sandbox is closed. Start a new task'],
  ['云端执行连接中断，请重新开始任务', 'The cloud execution connection was interrupted. Start the task again'],
  ['Python 测试失败，请检查沙盒初始化命令和运行环境', 'The Python test failed. Check the sandbox setup command and runtime'],
  ['请使用沙盒工作目录内的相对文件路径', 'Use a relative file path within the sandbox workspace'],
  ['沙盒输入文件不在当前资料范围内', 'The input file is outside the current task’s available files'],
  ['沙盒文件每个最多 20 MB，每批最多 50 MB', 'Sandbox files are limited to 20 MB each and 50 MB per batch'],
  ['请选择有内容的沙盒输出文件', 'Choose a non-empty output file from the sandbox'],
  ['沙盒输出文件发生变化，请完成写入后再导出', 'The sandbox output file changed. Finish writing it before exporting'],
  ['技能脚本请选择 Python、Bash 或 Node.js 文件', 'Choose a Python, Bash, or Node.js skill script'],
  ['技能文件总大小超过 50 MB', 'The skill files exceed 50 MB in total'],
  ['在独立云端沙盒执行 Python，处理数据、计算或生成文件', 'Running Python in the cloud sandbox'],
  ['在云端运行管理员启用技能中的 Python、Bash 或 Node.js 脚本', 'Running a skill script in the cloud sandbox'],
];

export default taskSystemMessages;
