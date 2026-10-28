export const userGuide = [
  {
    id: 'getting-started',
    title: ['开始使用', 'Getting started'],
    summary: ['发起任务、添加附件，以及查看花卷的执行进度。', 'Start a task, add files, and follow Huajuan’s progress.'],
    articles: [
      {
        id: 'first-task',
        title: ['发起一个任务', 'Start a task'],
        paragraphs: [
          ['在对话页写下你想完成的事情。说明目标、已有资料和想要的结果，会更方便花卷理解你的要求。需要查资料时，可以写明主题、时间范围，并要求附上来源。', 'Describe what you want to accomplish on the chat page. Include the goal, available material, and the result you want. For research, specify the topic and date range and ask for sources.'],
          ['发送后，对话中会显示任务状态；有执行计划时，可以展开查看各步进度。想结束当前任务，点击输入框右侧的“停止生成”。', 'After sending, the chat shows the task status. When a plan is available, expand it to see progress on each step. Select “Stop generating” beside the message box to stop the current task.'],
        ],
        steps: [
          ['点击“新任务”，也可以直接在当前对话中继续提问。', 'Select “New task”, or continue asking questions in the current chat.'],
          ['输入要求，点击发送按钮。电脑上可按 Enter 发送，Shift + Enter 换行。', 'Enter your request and select Send. On a computer, Enter sends the message and Shift + Enter adds a new line.'],
          ['阅读结果后继续补充要求，例如“把结论整理成表格”。', 'Follow up with any changes you want, such as “Put the conclusions in a table.”'],
        ],
        action: { label: ['开始对话', 'Open chat'], href: '/' },
      },
      {
        id: 'message-attachments',
        title: ['把图片和文档交给花卷', 'Add images and documents'],
        paragraphs: [
          ['点击输入框旁的回形针上传附件，也可以把文件拖进输入框，或粘贴剪贴板中的图片。上传完成后，在消息里说明要分析什么，再一起发送。', 'Use the paperclip beside the message box, drag files into it, or paste an image from your clipboard. Once the upload finishes, describe what you want analyzed and send the message.'],
          ['消息附件支持图片和 PDF、Word、Excel、CSV、TXT、Markdown 文档。每条消息最多 5 个附件，每个文件最多 20 MB。发送前可点击附件旁的移除按钮调整文件。', 'Message attachments accept images and PDF, Word, Excel, CSV, TXT, and Markdown documents. Add up to 5 files per message, up to 20 MB each. Use the remove button beside an attachment to change your selection before sending.'],
        ],
        action: { label: ['前往对话页', 'Open chat'], href: '/' },
      },
      {
        id: 'task-approvals',
        title: ['确认花卷即将执行的操作', 'Review an action before it runs'],
        paragraphs: [
          ['任务需要授权时，会显示“需要你确认”的卡片。展开内容，核对网址、操作对象、收件人、填写内容或待提交文件，再选择“允许这一次”或“拒绝”。', 'When a task needs approval, it shows an “Approval needed” card. Review the URL, target, recipient, form contents, or file being submitted, then choose “Allow once” or “Decline”.'],
          ['每次确认只对应卡片里的这一次操作，请在请求发起后的 5 分钟内处理。任务失败、停止或中断后，可以继续发送消息，也可以从回复下方重新生成。', 'Each approval covers the single action shown on the card. Respond within 5 minutes of the request. After a task fails, stops, or is interrupted, you can send another message or regenerate the reply.'],
        ],
        note: ['写回远端文件时，确认内容会列出目标位置；同名文件会被覆盖，请先查看待提交文件。', 'When writing a file to remote storage, the approval shows its destination. A file with the same name will be replaced, so review the submitted file first.'],
      },
    ],
  },
  {
    id: 'chats-projects',
    title: ['对话与项目', 'Chats and projects'],
    summary: ['整理对话、保存结果，让同一项目的资料和要求放在一起。', 'Organize chats, save results, and keep project files and instructions together.'],
    articles: [
      {
        id: 'manage-chats',
        title: ['查找和整理对话', 'Organize your chats'],
        paragraphs: [
          ['对话保存在左侧列表中，点击标题即可继续。手机上先点左上角的菜单按钮打开列表。对话菜单里可以置顶、重命名、移动到项目或删除对话。', 'Your chats appear in the left sidebar. Select a title to continue. On a phone, open the list with the menu button at the top left. A chat’s menu lets you pin, rename, move, or delete it.'],
          ['修改已发送的消息，或重新生成某条回复前，会出现确认窗口。确认后会从该位置重新执行，并删除原回复及后续对话、任务历史和成果。', 'Editing a sent message or regenerating a reply opens a confirmation dialog. Confirming starts again from that point and removes the original reply and later messages, task history, and results.'],
        ],
        action: { label: ['查看对话', 'View chats'], href: '/' },
      },
      {
        id: 'save-results',
        title: ['下载成果和导出回复', 'Download results and export replies'],
        paragraphs: [
          ['花卷生成的文件会出现在回复下方。点击文件下载；也可以打开页面顶部的“资料”，在“成果与引用”中查看生成文件和引用来源。', 'Files created by Huajuan appear below the reply. Select a file to download it, or open “Files” at the top of the page and choose “Results and sources” to see files and citations.'],
          ['回复下方可以复制文字，或从导出菜单保存为 Markdown、PDF、Word 文档。需要听内容时点击“朗读回复”；设备提供分享功能时，也会显示分享按钮。', 'Use the controls below a reply to copy its text or export it as Markdown, PDF, or a Word document. Select “Read aloud” to listen to the reply. A share button is also shown when your device offers sharing.'],
        ],
        action: { label: ['查看文件库', 'Open file library'], href: '/settings?section=files' },
      },
      {
        id: 'project-instructions',
        title: ['用项目整理长期工作', 'Organize ongoing work in a project'],
        paragraphs: [
          ['项目把相关对话、共享资料和工作要求放在一起。可以为一个研究主题、客户或写作任务建一个项目，再把相关对话移进去。', 'A project groups related chats, shared files, and instructions. Create one for a research topic, client, or writing assignment, then move the relevant chats into it.'],
        ],
        steps: [
          ['在左侧“项目”旁点击“管理”，再点“创建项目”。', 'Select “Manage” beside Projects in the sidebar, then “Create project”.'],
          ['填写项目名称、介绍和项目指令。项目指令适合记录目标、写作格式和工作要求。', 'Enter a name, description, and project instructions. Use the instructions for goals, output formats, and working requirements.'],
          ['从项目筛选中选择项目，再开始新对话；已有对话可通过菜单中的“移动到项目”归类。', 'Choose the project in the sidebar filter before starting a chat. Use “Move to project” in an existing chat’s menu to organize it.'],
        ],
        note: ['删除项目时，对话及其附件、任务历史和成果会移至“未归类”；项目本身及共享资料会删除。', 'Deleting a project moves its chats, attachments, task history, and results to Uncategorized. The project and its shared files are deleted.'],
        action: { label: ['前往对话页', 'Open chat'], href: '/' },
      },
    ],
  },
  {
    id: 'files-resources',
    title: ['文件与资料', 'Files and resources'],
    summary: ['区分个人文件、对话附件和项目共享资料，找到需要的文件。', 'Find and organize personal files, chat attachments, and shared project resources.'],
    articles: [
      {
        id: 'file-library',
        title: ['整理个人文件库', 'Organize your file library'],
        paragraphs: [
          ['在“设置 → 文件”中查看个人文件库。可以上传文件、新建文件夹，搜索当前文件夹，并按名称、最近修改时间或大小排序。', 'Open Settings → Files to view your file library. Upload files, create folders, search the current folder, and sort by name, modification time, or size.'],
          ['打开文件操作菜单，可以重命名、移动、下载或复制到项目。支持编辑的较小文本文件会显示“编辑文本”。勾选多个文件后，可使用批量操作。', 'A file’s menu offers rename, move, download, and copy-to-project actions. Small editable text files also have an “Edit text” action. Select several files to use bulk actions.'],
        ],
        note: ['文件被对话或任务使用时，删除窗口会提示对应位置。请按提示处理相关引用后，再删除文件。', 'If a chat or task uses a file, the deletion dialog points you to its location. Follow those instructions to remove the relevant references before deleting the file.'],
        action: { label: ['打开文件库', 'Open file library'], href: '/settings?section=files' },
      },
      {
        id: 'shared-resources',
        title: ['给对话和项目添加资料', 'Add chat and project resources'],
        paragraphs: [
          ['在对话顶部打开“资料”，可分别管理“当前对话”和“项目共享资料”。对话开始后可以添加对话资料；对话加入项目后，可以添加供该项目使用的共享资料。', 'Open “Files” at the top of a chat to manage Current chat files and Shared project files separately. Start a chat to add its resources; add the chat to a project to use shared project files.'],
          ['资料栏接受文档、表格、图片、音频和视频，单个文件最多 20 MB。查看资料时可以直接打开文件；对话里生成的成果放在旁边的“成果与引用”栏目中。', 'The files panel accepts documents, spreadsheets, images, audio, and video, up to 20 MB per file. Open a file to view it. Generated results are collected in the adjacent “Results and sources” tab.'],
        ],
        action: { label: ['前往对话页', 'Open chat'], href: '/' },
      },
    ],
  },
  {
    id: 'media-creation',
    title: ['图片与语音', 'Images and audio'],
    summary: ['生成图片、编辑参考图、制作配音和复刻自己的音色。', 'Generate and edit images, create speech, and clone a voice.'],
    articles: [
      {
        id: 'create-images',
        title: ['生成和编辑图片', 'Generate and edit images'],
        paragraphs: [
          ['从“媒体创作”进入“图片生成”。在“生成图片”模式中写下画面描述，再选择图片比例、数量和页面提供的生成选项。主体、场景、风格和需要出现的文字都可以写进描述。', 'Open Media studio → Image generation. In “Generate image” mode, describe the image and choose its aspect ratio, count, and the available generation options. Include the subject, setting, style, and any text you want in the picture.'],
          ['选择“编辑图片”后，先上传参考图片，再描述要修改的部分。可用的参考图数量和大小限制显示在上传区域。生成结果和历史记录可以查看、下载或删除。', 'For “Edit image”, upload reference images and describe the changes. The upload area shows the allowed number and size of reference images. View, download, or delete results in the output and history areas.'],
        ],
        note: ['页面显示“待开通”时，可以先查看已有作品；服务开通后即可提交新的创作。', 'When the service is marked “Not enabled”, you can view existing work. New creation requests become available once the service is enabled.'],
        action: { label: ['打开图片生成', 'Open image generation'], href: '/media/image' },
      },
      {
        id: 'create-speech',
        title: ['把文字变成配音', 'Turn text into speech'],
        paragraphs: [
          ['在“媒体创作 → 语音合成”中输入配音文本，从声音库选择一个音色。可以试听音色，再调整语速、稳定度、相似度和风格强度。', 'Enter your script in Media studio → Text to speech and select a voice from the voice library. Preview a voice, then adjust speed, stability, similarity, and style intensity.'],
          ['选择 MP3 或 WAV 格式和采样率后，点击“生成语音”。生成记录保存在你的账号下，可以播放、下载音频或删除记录。', 'Choose MP3 or WAV and a sample rate, then select “Generate speech”. Recordings are saved to your account, where you can play, download, or delete them.'],
        ],
        action: { label: ['打开语音合成', 'Open text to speech'], href: '/media/audio' },
      },
      {
        id: 'clone-voice',
        title: ['复刻一个音色', 'Clone a voice'],
        paragraphs: [
          ['在语音合成页切换到“声音复刻”，填写音色名称并上传清晰的单人录音。录音支持 WAV、MP3、M4A，时长 10 秒至 5 分钟，大小最多 20 MB；页面建议使用 1 至 2 分钟的样本。', 'Switch to “Voice cloning” on the text-to-speech page. Name the voice and upload a clear recording of one speaker. Use a WAV, MP3, or M4A file from 10 seconds to 5 minutes long and up to 20 MB. The page recommends a sample of 1 to 2 minutes.'],
          ['确认你拥有录音的使用权并已获得声音本人的授权，再点击“创建音色”。音色可用后，就能在声音库中选择它来生成配音。可以用“刷新状态”查看处理进度。', 'Confirm that you have the right to use the recording and the speaker’s permission, then select “Create voice”. Once ready, the voice can be selected from the library for speech generation. Use “Refresh status” to check its progress.'],
        ],
        action: { label: ['打开语音合成', 'Open text to speech'], href: '/media/audio' },
      },
    ],
  },
  {
    id: 'connections-browser',
    title: ['连接与浏览器', 'Connections and browser'],
    summary: ['接入自己的工具与远程文件，查看和接管网页操作。', 'Connect your tools and remote files, and view or take over browser activity.'],
    articles: [
      {
        id: 'external-connections',
        title: ['连接工具和远程文件', 'Connect tools and remote files'],
        paragraphs: [
          ['在“设置 → 外部连接”中添加 MCP 工具，或连接 WebDAV、S3、SFTP、SMB、加密 FTP 文件服务。MCP 是外部工具的连接方式；填写服务提供的地址和认证信息后，花卷就可以按你的授权使用相应工具。', 'In Settings → Connections, add MCP tools or connect WebDAV, S3, SFTP, SMB, or encrypted FTP storage. MCP connects external tools: enter the service URL and authentication details, then authorize the tools Huajuan may use.'],
        ],
        steps: [
          ['填写连接名称，选择类型，再按页面要求填写地址和认证信息。', 'Name the connection, choose its type, and enter the requested address and authentication details.'],
          ['点击“添加连接”，需要网页登录授权的连接再完成授权，然后点击“测试连接”。', 'Select “Add connection”. Complete browser authorization when required, then select “Test connection”.'],
          ['MCP 连接可勾选允许使用的工具；文件连接可通过“浏览文件”查看和导入资料。', 'For MCP connections, select the tools to enable. For storage connections, use “Browse files” to view and import files.'],
        ],
        note: ['写回远端时，请核对完整文件路径，并确认覆盖同名文件。助手调用外部工具或写回文件时，会展示待执行内容供你确认。', 'When writing to remote storage, check the full destination path and confirm replacement of any file with the same name. Assistant calls to external tools and remote file writes show their contents for your approval.'],
        action: { label: ['管理外部连接', 'Manage connections'], href: '/settings?section=connections' },
      },
      {
        id: 'browser-control',
        title: ['查看和接管网页操作', 'View and control the browser'],
        paragraphs: [
          ['“设置 → 浏览器”提供网页预览和操作入口。输入网址打开网页，可以在画面中选中位置，再填入文字、密码或验证码。网页登录状态保存在你的账号中。', 'Open Settings → Browser to view and operate a web page. Enter a URL, select a location in the preview, then type text, a password, or a verification code. Website sign-in sessions are stored in your account.'],
          ['任务正在使用浏览器时，可点击“手动接管”处理登录或验证，完成后点击“交还给任务”。需要查看最新画面时，点击“刷新画面”。', 'While a task uses the browser, select “Take control” to handle sign-in or verification. Select “Return control to task” when finished. Use “Refresh preview” to see the latest page.'],
          ['“选择网页元素与传输文件”中可以选中网页按钮或输入框、从文件库上传文件，或下载网页提供的文件。关闭浏览器时，可以选择保留登录状态，或清除所有网站的登录状态。', 'Under “Page elements and file transfer”, select a page button or field, upload a file from your library, or download a file from the page. When closing the browser, choose whether to keep or clear website sign-in sessions.'],
        ],
        action: { label: ['打开浏览器', 'Open browser controls'], href: '/settings?section=browser' },
      },
    ],
  },
  {
    id: 'personal-settings',
    title: ['账号与偏好', 'Account and preferences'],
    summary: ['调整界面、助手和账号权限，让日常使用顺手一些。', 'Adjust the interface, assistant preferences, and account permissions.'],
    articles: [
      {
        id: 'general-settings',
        title: ['调整界面和个人资料', 'Adjust the interface and your profile'],
        paragraphs: [
          ['“设置 → 通用”中可以更换头像和昵称，选择浅色、深色或跟随系统的主题，调整文字大小与完成提示音音量。音量设为 0 可关闭完成提示音。修改后点击对应区域的保存按钮。', 'In Settings → General, change your avatar and display name, choose a light, dark, or system theme, and adjust text size and completion sound volume. Set the volume to 0 to mute the sound. Save changes using the button in the relevant section.'],
          ['界面语言可在页面顶部或通用设置中切换。首次打开时按浏览器语言选择；切换后立即生效。', 'Switch the interface language at the top of the page or in General settings. On your first visit, Huajuan uses your browser’s language. Changes take effect immediately.'],
          ['账号操作也在通用设置中。更改密码需填写当前密码和两次新密码；普通账号还可以用当前密码确认更改邮箱。', 'Account controls are also in General settings. To change your password, enter the current password and the new password twice. Regular accounts can also change their email address by confirming the current password.'],
        ],
        action: { label: ['打开通用设置', 'Open General settings'], href: '/settings?section=general' },
      },
      {
        id: 'assistant-preferences',
        title: ['设置助手的表达和工作要求', 'Set your assistant’s style and instructions'],
        paragraphs: [
          ['在“设置 → 助手”中填写助手名称、回复语言、表达风格和长期工作要求，再点击“保存助手”。也可以上传助手头像，或用 SOUL.md 导入、导出这些个性设置。', 'In Settings → Assistant, set a name, reply language, writing style, and ongoing instructions, then select “Save assistant”. You can also upload an avatar or import and export preferences with a SOUL.md file.'],
          ['“设置 → 通用”里的“对话指令”用于记录每次对话都要遵循的要求，例如先给结论、引用数据时注明来源。常用指令可以在“管理指令模板”中保存。当前消息中的明确要求优先。', 'Use Chat instructions in Settings → General for requirements that apply to every chat, such as answering first or citing data sources. Save reusable instructions under “Manage instruction templates”. Specific instructions in the current message take priority.'],
        ],
        action: { label: ['设置助手', 'Open Assistant settings'], href: '/settings?section=assistant' },
      },
      {
        id: 'permissions-passkeys',
        title: ['管理权限和通行密钥', 'Manage permissions and passkeys'],
        paragraphs: [
          ['在“设置 → 权限与安全”中管理完成通知、网页操作和外部工具。完成通知还需要浏览器授权，页面打开期间可收到任务完成提醒。关闭功能权限会停止正在执行的任务。', 'Manage completion notifications, browser actions, and external tools in Settings → Permissions and security. Notifications also need browser permission and can alert you while the page is open. Turning off a feature permission stops active tasks.'],
          ['添加通行密钥后，可以使用设备的指纹、面容或屏幕锁登录。填写一个便于识别的名称，点击“添加通行密钥”，按设备提示完成验证。已有密钥可以在列表中查看和移除。', 'A passkey lets you sign in with your device’s fingerprint, face recognition, or screen lock. Enter a recognizable name, select “Add passkey”, and complete the device verification. View and remove existing passkeys in the list.'],
        ],
        action: { label: ['管理权限与安全', 'Open Permissions and security'], href: '/settings?section=permissions' },
      },
    ],
  },
  {
    id: 'backup-usage',
    title: ['备份与用量', 'Backups and usage'],
    summary: ['保存工作资料，查看任务花费、执行记录和存储空间。', 'Back up your work and review task costs, activity, and storage.'],
    articles: [
      {
        id: 'backup-restore',
        title: ['备份和恢复工作资料', 'Back up and restore your work'],
        paragraphs: [
          ['在“设置 → 备份”中选择对话、项目、文件和个人设置，填写至少 10 个字符的备份密码，再点击“立即备份”。备份可保存在账号中供下载，也可以保存到已启用的远程文件连接。', 'In Settings → Backups, choose chats, projects, files, and personal settings, enter a backup password of at least 10 characters, and select “Back up now”. Save it to your account for download or to an enabled remote storage connection.'],
          ['需要定时备份时，按上方填写的内容、密码和位置选择每天或每周的执行时间，再点击“添加定时备份”。页面里的时间使用北京时间（UTC+8）。', 'For scheduled backups, use the content, password, and destination entered above, choose a daily or weekly time, and select “Add schedule”. The page uses Beijing time (UTC+8).'],
        ],
        steps: [
          ['恢复时，在“从备份恢复”中选择 .vxb 文件并输入备份密码。', 'To restore, select a .vxb file under “Restore from backup” and enter its password.'],
          ['点击“检查备份内容”，核对备份时间和内容。需要恢复个人设置时，勾选“应用备份中的个人设置”。', 'Select “Inspect backup” and review its date and contents. Select “Apply personal settings from the backup” when you also want those settings restored.'],
          ['点击“恢复为新副本”。对话、项目和文件作为新副本加入；勾选的个人设置会应用到账号。', 'Select “Restore as a new copy”. Chats, projects, and files are added as new copies. Personal settings are applied when selected.'],
        ],
        note: ['恢复需要原备份密码，请妥善保存。备份不包含花费记录、登录状态、服务密钥、网页操作状态、连接密码和权限授权；备份头像需同时选择“文件”。配音偏好会保存，服务商托管的自定义音色需要另行设置。', 'Keep the backup password: it is required for restoration. Backups exclude cost records, sign-in sessions, service keys, browser sessions, connection passwords, and permissions. Include Files to back up avatars. Voice preferences are saved; custom voices hosted by the provider require separate setup.'],
        action: { label: ['打开备份设置', 'Open Backups'], href: '/settings?section=backups' },
      },
      {
        id: 'usage-activity',
        title: ['查看花费、执行记录和存储', 'Review costs, activity, and storage'],
        paragraphs: [
          ['点击页面右上角的本月花费，或打开“设置 → 用量与日志”。按账单月份查询，也可以填入任务编号查看某个任务。花费以人民币显示，每月 1 日按北京时间重新累计，历史记录保留。', 'Select the monthly cost at the top right, or open Settings → Usage and logs. Filter by billing month or enter a task ID. Costs are shown in CNY; monthly totals restart on the first day of the month in Beijing time, while past records are kept.'],
          ['“工具执行记录”列出各步的状态、耗时和失败原因，可以下载诊断记录。存储区域显示文件分类和占用空间，勾选列出的可清理文件后可删除它们。', 'Tool activity shows each step’s status, duration, and errors, with an option to download diagnostics. The storage section shows file categories and space used. Select files listed as eligible for cleanup to delete them.'],
        ],
        note: ['标为“费用待记录”的调用会单独提示，金额暂未计入花费合计。', 'Requests with pending costs are listed separately; those amounts are not yet included in the total.'],
        action: { label: ['查看用量与日志', 'Open Usage and logs'], href: '/settings?section=usage' },
      },
    ],
  },
];
