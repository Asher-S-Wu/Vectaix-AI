export const adminGuide = [
  {
    id: 'admin-models',
    title: ['模型服务', 'Model services'],
    summary: ['连接模型服务，设置全平台使用的模型、能力与计价。', 'Connect a model service and set the model, capabilities, and usage prices for all users.'],
    articles: [
      {
        id: 'admin-model-connection',
        title: ['连接模型服务', 'Connect a model service'],
        paragraphs: [
          ['在“设置 → 管理后台 → 模型服务”中填写服务商提供的连接信息。连接协议是接口使用的格式，可以选择 Chat、Message 或 Response。请与服务商提供的接口保持一致。', 'Open Settings → Admin → Model services and enter your provider’s connection details. Choose Chat, Message, or Response to match the provider’s API format.'],
          ['保存后的模型配置用于所有用户的新任务。API Key 是调用服务的密钥，保存后会加密存放在服务器。', 'Saved model settings apply to new tasks for all users. The API key authorizes service requests and is stored encrypted on the server.'],
        ],
        steps: [
          ['选择“连接协议”，填写 HTTPS 格式的“API 地址”和具有模型调用权限的 API Key。地址可以是服务商的基础地址或完整接口地址。', 'Choose the API protocol, enter the HTTPS API URL, and provide an API key with permission to use the model. The URL can be the provider’s base URL or full endpoint.'],
          ['点击“获取模型列表”，选择要使用的模型，也可以填写服务商提供的模型 ID。', 'Click Load models and choose a model, or enter the model ID supplied by your provider.'],
          ['填写显示名称，核对模型能力和用量计价后，点击“保存模型设置”。', 'Enter a display name, review the capabilities and usage pricing, then click Save model settings.'],
        ],
        note: ['已有密钥时，留空可保留它。更换服务地址或协议时，需要重新填写对应的密钥；勾选“保存时删除密钥并停用模型服务”后保存，会停用模型服务。', 'Leave the key field blank to keep a saved key. If you change the API URL or protocol, enter the key for that connection again. To disable the service, select “Delete the key and disable model service on save” and save.'],
        action: { label: ['打开模型服务', 'Open model services'], href: '/settings?section=admin&adminSection=models' },
      },
      {
        id: 'admin-model-capabilities',
        title: ['设置模型能力和用量计价', 'Set model capabilities and usage prices'],
        paragraphs: [
          ['“上下文长度”是模型一次处理内容的容量，“单次最大输出”是一次回复的输出上限，两项都按 Token 计量。Token 是模型计算文字用量的单位。请按服务商给出的模型规格填写，单次最大输出需小于上下文长度。', 'Context window is how much content a model can process at once. Maximum output tokens sets the limit for one response. Both values are measured in tokens, the units models use to count text usage. Use the provider’s model specifications and keep maximum output below the context window.'],
          ['根据模型的实际能力勾选“允许调用工具”和“模型可理解图片”。“用量计价”分别填写输入、缓存输入和输出每百万 Token 的美元价格，平台用这些价格统计模型花费。', 'Set Allow tool use and Model can understand images according to the model’s capabilities. Under Usage pricing, enter the USD price per million tokens for input, cached input, and output. The platform uses these prices to calculate model usage costs.'],
        ],
        action: { label: ['调整模型能力与计价', 'Edit capabilities and pricing'], href: '/settings?section=admin&adminSection=models' },
      },
    ],
  },
  {
    id: 'admin-skills',
    title: ['全局技能', 'Global skills'],
    summary: ['安装、启用和维护供花卷使用的工作方法与参考资料。', 'Install, enable, and maintain workflows and reference material for Huajuan.'],
    articles: [
      {
        id: 'admin-skill-install',
        title: ['从 GitHub 安装技能', 'Install skills from GitHub'],
        paragraphs: [
          ['技能包含处理某类任务的工作方法和参考资料。管理员在“全局技能”中安装后，花卷会按任务需要读取已启用的技能。启用的技能供所有用户使用。', 'Skills contain workflows and reference material for particular tasks. After an administrator installs them under Global skills, Huajuan reads enabled skills as needed. Enabled skills are available to all users.'],
          ['页面通过 Skills CLI 管理技能。选择来源前，先查看仓库中的技能内容，确认它适合平台要处理的任务。', 'Skills CLI handles installation and maintenance from this page. Before choosing a repository, review its skills and check that they fit the tasks your platform handles.'],
        ],
        steps: [
          ['进入“设置 → 管理后台 → 全局技能”，在“GitHub 来源”填写公开仓库，例如 owner/repository。', 'Open Settings → Admin → Global skills. Enter a public repository, such as owner/repository, under GitHub repository.'],
          ['需要安装其中一个技能时，填写“技能名称”；留空会安装仓库中的全部技能。', 'Enter a Skill name to install a particular skill. Leave it blank to install all skills in the repository.'],
          ['点击“安装技能”，完成后在“全局技能库”核对名称、介绍、来源和启用状态。', 'Click Install skills. When installation completes, check the name, description, source, and enabled state in the skill list.'],
        ],
        action: { label: ['打开全局技能', 'Open global skills'], href: '/settings?section=admin&adminSection=skills' },
      },
      {
        id: 'admin-skill-maintenance',
        title: ['启用、更新和删除技能', 'Enable, update, and delete skills'],
        paragraphs: [
          ['每个技能旁都有启用开关、更新按钮和删除按钮。启用开关控制花卷是否可以读取它；更新按钮通过 Skills CLI 从原仓库更新该技能。', 'Each skill has an enable switch and buttons to update or delete it. The switch controls whether Huajuan can read the skill. The update button uses Skills CLI to update it from its original repository.'],
          ['删除时需要再次确认，确认后会从全平台移除该技能及其配套文件。操作后可以展开“查看 Skills CLI 执行记录”查看返回的信息。', 'Confirming deletion removes the skill and its supporting files from the platform. To read a command’s output, expand View Skills CLI output after the operation.'],
        ],
        note: ['同名技能来自不同仓库时，先核对现有技能的来源，再决定要保留哪一个。安装页面会提示来源冲突。', 'If different repositories contain a skill with the same name, check the installed skill’s source before deciding which to keep. The installation page reports source conflicts.'],
        action: { label: ['管理技能库', 'Manage the skill library'], href: '/settings?section=admin&adminSection=skills' },
      },
    ],
  },
  {
    id: 'admin-sandbox',
    title: ['云端沙盒', 'Cloud sandbox'],
    summary: ['配置花卷运行 Python 和技能脚本所需的环境。', 'Configure the environment Huajuan uses to run Python and skill scripts.'],
    articles: [
      {
        id: 'admin-sandbox-setup',
        title: ['启用并测试云端执行', 'Enable and test cloud execution'],
        paragraphs: [
          ['花卷通过 Railway 云端沙盒执行 Python 和技能脚本，并把结果文件交付到对话。每个任务使用独立环境，任务结束后回收环境。保存的沙盒配置用于所有用户的新任务。', 'Huajuan uses Railway cloud sandboxes to run Python and skill scripts and deliver result files in the chat. Each task uses a separate environment that is removed when the task ends. Saved sandbox settings apply to new tasks for all users.'],
          ['“初始化命令”在准备环境时执行，可用于安装额外依赖。Python 和常用的数据、文档处理库已预装。', 'The optional Setup command runs while the environment is being prepared and can install extra dependencies. Python and common data and document libraries are preinstalled.'],
        ],
        steps: [
          ['打开“设置 → 管理后台 → 云端沙盒”，填写 Railway 项目的环境 ID，以及有权访问该环境的 Railway API Token。', 'Open Settings → Admin → Cloud sandbox. Enter the Railway project environment ID and a Railway API token with access to that environment.'],
          ['勾选“启用云端执行”，设置 CPU、内存和单次执行时限，然后点击“保存沙盒设置”。', 'Select Enable cloud execution, set CPU, memory, and the execution time limit, then click Save sandbox settings.'],
          ['保存后点击“测试 Python 执行”，查看连接提示和页面下方的 Python 测试结果。', 'After saving, click Test Python execution and review the connection message and Python test output below.'],
        ],
        note: ['CPU 可设为 0.5 至 4 vCPU，内存可设为 0.5 至 8 GB，单次命令执行时限可设为 10 至 300 秒。测试也会创建沙盒并使用 Railway 的计算资源。', 'CPU can be set from 0.5 to 4 vCPU, memory from 0.5 to 8 GB, and each command’s time limit from 10 to 300 seconds. Running a test also creates a sandbox and uses Railway computing resources.'],
        action: { label: ['打开云端沙盒', 'Open cloud sandbox'], href: '/settings?section=admin&adminSection=sandbox' },
      },
    ],
  },
  {
    id: 'admin-media',
    title: ['图片与语音服务', 'Image and audio services'],
    summary: ['开通创作服务，设置全平台使用的连接和默认参数。', 'Enable creative services and set their connections and defaults for all users.'],
    articles: [
      {
        id: 'admin-media-services',
        title: ['开通图片和语音服务', 'Enable image and audio services'],
        paragraphs: [
          ['在“设置 → 管理后台 → 图片与语音 → 媒体设置”中，分别配置图片服务和语音服务。图片服务用于生成和编辑图片；语音服务使用 ElevenLabs，用于语音合成与朗读。', 'Open Settings → Admin → Images and audio → Media settings to configure image and audio services separately. The image service generates and edits images. The audio service uses ElevenLabs for speech generation and read-aloud.'],
          ['每项服务都有自己的启用开关、API 地址和 API Key。保存后的服务配置供所有用户使用。', 'Each service has its own Enable switch, API URL, and API key. The saved settings apply to all users.'],
        ],
        steps: [
          ['展开“图片服务”或“语音服务”，填写公开的 HTTPS API 地址和对应密钥。', 'Expand Image service or Audio service and enter its public HTTPS API URL and corresponding key.'],
          ['图片服务选择模型、默认尺寸和张数；语音服务设置默认音色 ID、格式、语速及其他声音参数。', 'For images, choose the model, default size, and image count. For audio, set the default voice ID, format, speed, and other voice parameters.'],
          ['勾选相应服务的“启用”，点击“保存媒体设置”，再到图片生成或语音合成页面试用。', 'Select Enable for the service and click Save media settings. Then try it in Image generation or Text to speech.'],
        ],
        note: ['已有密钥时，留空会保留它；更换 API 地址时，请重新填写对应的密钥。启用服务需要先保存密钥。', 'Leave the key field blank to keep a saved key. Enter the corresponding key again when changing the API URL. A key must be saved to enable a service.'],
        action: { label: ['打开媒体设置', 'Open media settings'], href: '/settings?section=admin&adminSection=media' },
      },
      {
        id: 'admin-media-defaults',
        title: ['保存全平台默认参数', 'Save defaults for all users'],
        paragraphs: [
          ['管理后台的“图片生成”和“语音合成”工作区提供“设为全平台默认参数”按钮。调整好当前选项后，点击它可以把这些选项保存为平台默认值。', 'In the admin Image generation and Text to speech workspaces, adjust the options and click Set as default for all users to save them as platform defaults.'],
          ['图片可保存当前的模型、尺寸和张数。语音可保存选定音色、格式、采样率、语速及声音参数。设置默认音色时，请确认该音色适合全平台使用。', 'Image defaults include the current model, size, and image count. Audio defaults include the selected voice, format, sample rate, speed, and voice parameters. When choosing a default voice, check that it is suitable for use across the platform.'],
        ],
        note: ['看到“已保存为全平台媒体默认参数”后，表示当前选项已保存。个人创作和修改全平台默认值是两个独立操作。', 'The message “Saved as the media defaults for all users” confirms that the current options have been saved. Creating personal work and changing platform defaults are separate actions.'],
        action: { label: ['打开后台创作工作区', 'Open the admin creative workspace'], href: '/settings?section=admin&adminSection=image' },
      },
    ],
  },
  {
    id: 'admin-users',
    title: ['用户管理', 'User management'],
    summary: ['查看账号信息，协助普通用户重置密码和清理账号。', 'Review accounts, help users reset passwords, and remove unused accounts.'],
    articles: [
      {
        id: 'admin-user-accounts',
        title: ['查找账号和重置密码', 'Find accounts and reset passwords'],
        paragraphs: [
          ['进入“设置 → 管理后台 → 用户管理”，点击“管理用户”。列表显示邮箱、账号身份、注册时间、对话数量和累计模型花费，可以按邮箱搜索。', 'Open Settings → Admin → User management and click Manage users. The list shows each email, account role, join date, conversation count, and total model spending. You can search by email.'],
          ['普通用户的账号旁提供“重置密码”操作。确认后会生成随机密码，并退出该账号已有的登录会话。', 'Accounts marked User have a Reset password action. Confirming it generates a random password and signs the account out of its existing sessions.'],
        ],
        steps: [
          ['搜索并核对用户邮箱，点击该账号旁的“重置密码”。', 'Search for and verify the user’s email, then click Reset password beside the account.'],
          ['在确认框中核对邮箱，确认重置。页面会显示新密码。', 'Check the email in the confirmation dialog and confirm the reset. The page displays the new password.'],
          ['点击“复制密码”，通过合适的私密渠道交给用户，并请用户登录后修改为自己的密码。', 'Click Copy password and share it privately with the user. Ask them to choose their own password after signing in.'],
        ],
        action: { label: ['打开用户管理', 'Open user management'], href: '/settings?section=admin&adminSection=users' },
      },
      {
        id: 'admin-user-delete',
        title: ['删除普通用户账号', 'Delete a user account'],
        paragraphs: [
          ['在用户列表中找到要删除的普通用户，点击“删除用户”。确认框会显示邮箱和删除范围，请核对后再确认。', 'Find the regular user account in the list and click Delete user. Check the email and the data listed in the confirmation dialog before confirming.'],
          ['删除账号会永久删除该用户的对话、设置和文件。需要保留的资料，应在删除前完成备份或下载。', 'Deleting an account permanently removes that user’s chats, settings, and files. Back up or download anything you need to keep before deleting the account.'],
        ],
        action: { label: ['查看用户列表', 'View the user list'], href: '/settings?section=admin&adminSection=users' },
      },
    ],
  },
];
