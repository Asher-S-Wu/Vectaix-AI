import WorkspaceProject from "@/models/WorkspaceProject";
import WorkbenchSkill from "@/models/WorkbenchSkill";
import WorkbenchMemory from "@/models/WorkbenchMemory";
import UserSettings from "@/models/UserSettings";
import { requireObjectId, textField, workbenchError } from "./apiHelpers";

export const BUILTIN_SKILLS = [
  { builtinKey: "research", name: "深度调研", description: "检索资料、核实来源并整理研究结论", content: "先明确研究问题，使用可用搜索工具检索多个可靠来源，比较观点与证据。区分已核实事实、推断及尚未确认的信息。用中文形成结构清晰的研究报告并给出真实来源链接。禁止虚构引用。" },
  { builtinKey: "documents", name: "文档分析", description: "阅读项目资料、提取要点和差异并交付报告", content: "先列出项目资料，再按需读取原文，保留页码、段落或工作表行号。提取核心观点、关键数据与不同资料之间的差异，不得虚构没有读到的内容。根据读者与目标组织报告，使用实际可用的文档工具交付文件。" },
  { builtinKey: "tables", name: "表格分析", description: "整理数据、分析指标并制作表格", content: "确认数据来源、字段含义与统计口径，检查缺失值和重复项。分析计算必须基于实际数据，明确单位和假设，使用可用工具生成表格。未取得的数据不得虚构。" },
  { builtinKey: "content", name: "内容创作", description: "策划文章、营销文案与创意内容", content: "根据受众、渠道和表达目的设计内容。先提出明确主题，再以具体细节展开，保持自然流畅，避免空话套话。遵守用户的篇幅、语气与品牌要求。" },
  { builtinKey: "voice", name: "语音制作", description: "编写口播稿并制作语音内容", content: "根据听众与使用场景撰写适合朗读的口播稿，控制句长和节奏。仅在已配置的语音工具支持时生成音频。使用用户指定的声音和参数，交付真实生成的音频文件。" },
];

export async function requireProject(userId, projectId) {
  requireObjectId(projectId);
  const project = await WorkspaceProject.findOne({ _id: projectId, userId });
  if (!project) throw workbenchError("项目不存在", 404);
  return project;
}

export async function ensureBuiltinSkills(userId) {
  await WorkbenchSkill.bulkWrite(BUILTIN_SKILLS.map((skill) => ({ updateOne: {
    filter: { userId, builtinKey: skill.builtinKey },
    update: { $setOnInsert: { ...skill, userId, enabled: true } },
    upsert: true,
  } })));
}

export async function listEnabledSkills(userId) {
  await ensureBuiltinSkills(userId);
  return WorkbenchSkill.find({ userId, enabled: true }).sort({ createdAt: 1 }).lean();
}

export async function isPersonalMemoryEnabled(userId) {
  const settings = await UserSettings.findOne({ userId }).select("memoryEnabled");
  return settings ? settings.memoryEnabled : true;
}

export async function getMemoryContext(userId, projectId = null) {
  const scopes = [];
  if (await isPersonalMemoryEnabled(userId)) scopes.push({ scope: "personal", projectId: null });
  if (projectId) {
    const project = await requireProject(userId, String(projectId));
    if (project.memoryEnabled) scopes.push({ scope: "project", projectId });
  }
  if (!scopes.length) return "";
  const memories = await WorkbenchMemory.find({ userId, $or: scopes }).sort({ updatedAt: -1 }).limit(50).lean();
  return memories.map((memory) => `- [${memory.scope === "project" ? "项目" : "个人"}] ${memory.content}`).join("\n");
}

export async function saveMemory({ userId, projectId = null, content, source = "manual" }) {
  const value = textField(content, "记忆内容", 4000, true);
  if (!["manual", "automatic"].includes(source)) throw workbenchError("记忆来源无效");
  if (projectId !== null) {
    const project = await requireProject(userId, String(projectId));
    if (source === "automatic" && !project.memoryEnabled) return null;
  } else if (source === "automatic" && !(await isPersonalMemoryEnabled(userId))) return null;
  return WorkbenchMemory.create({ userId, projectId, scope: projectId ? "project" : "personal", content: value, source });
}
