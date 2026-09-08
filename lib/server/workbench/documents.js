import path from "node:path";
import { Worker } from "node:worker_threads";
import ExcelJS from "exceljs";
import { Document, Packer, Paragraph, HeadingLevel } from "docx";
import Conversation from "@/models/Conversation";
import WorkspaceProject from "@/models/WorkspaceProject";
import WorkbenchTask from "@/models/WorkbenchTask";
import WorkspaceDocument from "@/models/WorkspaceDocument";
import StoredFile from "@/models/StoredFile";
import { createStoredFile, deleteStoredFileDocument, getStoredFileAbsolutePath, serializeStoredFile } from "@/lib/server/storage/service";
import { requireObjectId, workbenchError } from "./apiHelpers";
import { withProjectLock } from "./projectLock";
import { inspectUploadedFile } from "@/lib/server/storage/fileInspection";
import { isSupportedUploadExtension } from "@/lib/shared/attachments";
import { probeVideoDuration } from "@/lib/media/server/videoMetadata";
import { probeAudioSource } from "@/lib/media/server/audioTranscoding";
import { beginMediaWriteLease, assertMediaWriteLeaseActive, endMediaWriteLease } from "@/lib/media/server/userOperationLeases";

export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const MAX_TEXT = 2_000_000;
const TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
};

async function requireProject(userId, projectId) {
  requireObjectId(projectId);
  if (!await WorkspaceProject.exists({ _id: projectId, userId })) throw workbenchError("项目不存在", 404);
}

async function extractDocument(buffer, extension) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(process.cwd(), "lib/server/workbench/documentParser.cjs"), {
      workerData: { buffer, extension },
      resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 },
    });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(workbenchError("文档解析超过 30 秒，请拆分文档后上传"));
    }, 30_000);
    worker.once("message", (message) => {
      clearTimeout(timer);
      void worker.terminate();
      if (message.error) reject(workbenchError(message.error, message.status));
      else resolve({ chunks: message.chunks, tables: message.tables });
    });
    worker.once("error", () => {
      clearTimeout(timer);
      reject(workbenchError("文档解析失败或内容超过限制，请检查并拆分文档"));
    });
    worker.once("exit", () => {
      clearTimeout(timer);
      reject(workbenchError("文档解析已中止"));
    });
  });
}

export async function requireResourceScope({ userId, projectId = null, conversationId = null }) {
  if (conversationId) {
    requireObjectId(conversationId);
    const conversation = await Conversation.findOne({ _id: conversationId, userId }).select('projectId').lean();
    if (!conversation || String(conversation.projectId || '') !== String(projectId || '')) throw workbenchError("对话资料范围无效", 404);
  } else if (!projectId) throw workbenchError("请选择当前对话", 400);
  if (projectId) await requireProject(userId, projectId);
}

export async function createScopedFileQuery({ userId, projectId = null, conversationId = null }) {
  await requireResourceScope({ userId, projectId, conversationId });
  const scopes = [];
  const taskScopes = [];
  if (conversationId) { scopes.push({ ownerType: 'conversation', ownerId: conversationId }); taskScopes.push({ conversationId }); }
  if (projectId) { scopes.push({ ownerType: 'project', ownerId: projectId }); taskScopes.push({ projectId }); }
  const tasks = await WorkbenchTask.find({ userId, $or: taskScopes }).select('_id artifacts.fileId').lean();
  for (const task of tasks) scopes.push({ ownerType: 'task', ownerId: String(task._id), fileId: { $in: task.artifacts.map(file => file.fileId) } });
  return { userId, $or: scopes };
}

export async function listProjectFiles({ userId, projectId = null, conversationId = null }) {
  const files = await StoredFile.find(await createScopedFileQuery({ userId, projectId, conversationId })).sort({ createdAt: -1 }).lean();
  return files.map(file => ({ ...serializeStoredFile(file), ownerType: file.ownerType, ownerId: file.ownerId }));
}

export async function uploadProjectDocument({ userId, projectId, file }) {
  return withProjectLock(userId, projectId, async () => {
    const mediaWriteLease = await beginMediaWriteLease(userId);
    try {
      return await uploadLockedProjectDocument({ userId, projectId, file, mediaWriteLease });
    } finally { await endMediaWriteLease(mediaWriteLease); }
  });
}

async function uploadLockedProjectDocument({ userId, projectId = null, conversationId = null, temporary = false, file, mediaWriteLease }) {
  if (!temporary) await requireResourceScope({ userId, projectId, conversationId });
  const ownerType = temporary ? 'temporary' : conversationId ? 'conversation' : 'project';
  const ownerId = temporary ? null : conversationId || projectId;
  if (!(file instanceof File) || file.size <= 0 || file.size > MAX_DOCUMENT_BYTES) throw workbenchError("请选择不超过 20MB 的资料文件");
  const originalName = file.name.trim();
  if (!originalName || originalName.length > 200) throw workbenchError("文件名不能为空且最多 200 个字");
  const extension = originalName.split(".").pop().toLowerCase();
  if (!Object.hasOwn(TYPES, extension) && !isSupportedUploadExtension(extension)) throw workbenchError("支持 PDF、Word、Excel、CSV、文字、图片、音频和视频资料");
  const input = Buffer.from(await file.arrayBuffer());
  if (!Object.hasOwn(TYPES, extension)) {
    const inspected = inspectUploadedFile(input, extension);
    if (!inspected) throw workbenchError("文件内容与扩展名不匹配");
    await assertMediaWriteLeaseActive(mediaWriteLease);
    const stored = await createStoredFile({ userId, input, originalName, extension, ...inspected, kind: conversationId || temporary ? "chat" : "project-media", ownerType, ownerId, mediaWriteLease });
    try {
      if (inspected.category === "audio") {
        const metadata = await probeAudioSource({ inputPath: getStoredFileAbsolutePath(stored), extension });
        stored.audioDuration = metadata.duration;
        stored.audioChannels = metadata.channels;
        stored.audioSampleRate = metadata.sampleRate;
      } else if (inspected.category === "video") {
        stored.videoDuration = await probeVideoDuration(getStoredFileAbsolutePath(stored));
      }
      await assertMediaWriteLeaseActive(mediaWriteLease);
      await stored.save();
      return serializeStoredFile(stored);
    } catch (error) { await deleteStoredFileDocument(stored); throw error; }
  }
  const { chunks, tables } = await extractDocument(input, extension);
  await assertMediaWriteLeaseActive(mediaWriteLease);
  const stored = await createStoredFile({ userId, input, originalName, extension, mimeType: TYPES[extension], category: "document", kind: conversationId || temporary ? "chat" : "project-document", ownerType, ownerId, mediaWriteLease });
  try { await WorkspaceDocument.create({ userId, projectId, conversationId, fileId: stored.fileId, chunks, tables }); }
  catch (error) { await deleteStoredFileDocument(stored); throw error; }
  return serializeStoredFile(stored);
}

export async function uploadConversationDocument({ userId, conversationId, projectId, file }) {
  return withProjectLock(userId, "task-creation", async () => {
    const mediaWriteLease = await beginMediaWriteLease(userId);
    try { return await uploadLockedProjectDocument({ userId, conversationId, projectId, file, mediaWriteLease }); }
    finally { await endMediaWriteLease(mediaWriteLease); }
  });
}

export async function uploadTemporaryDocument({ userId, file, mediaWriteLease }) {
  return uploadLockedProjectDocument({ userId, file, temporary: true, mediaWriteLease });
}

export async function requireReadableProjectDocument({ userId, projectId = null, conversationId = null, fileId }) {
  if (typeof fileId !== "string") throw workbenchError("文件编号无效");
  const query = await createScopedFileQuery({ userId, projectId, conversationId });
  if (!await StoredFile.exists({ ...query, fileId, category: "document" })) throw workbenchError("当前对话无法读取该文档", 404);
}

export async function readProjectDocument({ userId, projectId = null, conversationId = null, fileId, offset = 0, limit = 12 }) {
  if (typeof fileId !== "string" || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 30) throw workbenchError("文档读取参数不正确");
  await requireReadableProjectDocument({ userId, projectId, conversationId, fileId });
  const document = await WorkspaceDocument.findOne({ userId, fileId }, { chunks: { $slice: [offset, limit] } }).lean();
  if (!document) throw workbenchError("文件不存在", 404);
  const [summary] = await WorkspaceDocument.aggregate([{ $match: { _id: document._id } }, { $project: { total: { $size: "$chunks" } } }]);
  return { chunks: document.chunks, total: summary.total, nextOffset: offset + document.chunks.length < summary.total ? offset + document.chunks.length : null };
}

export async function deleteConversationDocument({ userId, conversationId, projectId, fileId }) {
  return withProjectLock(userId, "task-creation", async () => {
    await requireResourceScope({ userId, conversationId, projectId });
    if (await WorkbenchTask.exists({ userId, conversationId, status: { $in: ["queued", "running", "waiting_media"] } })) throw workbenchError("请等待当前任务结束后再删除资料", 409);
    const file = await StoredFile.findOne({ userId, ownerType: 'conversation', ownerId: conversationId, fileId });
    if (!file) throw workbenchError("当前对话资料不存在", 404);
    await Conversation.updateOne({ _id: conversationId, userId }, { $pull: { "messages.$[].parts": { $or: [{ "fileData.fileId": fileId }, { "inlineData.fileId": fileId }] } } });
    await deleteStoredFileDocument(file);
  });
}

export async function deleteProjectDocument({ userId, projectId, fileId }) {
  return withProjectLock(userId, projectId, () => deleteLockedProjectDocument({ userId, projectId, fileId }));
}

async function deleteLockedProjectDocument({ userId, projectId, fileId }) {
  await requireProject(userId, projectId);
  if (await WorkbenchTask.exists({ userId, projectId, status: { $in: ["queued", "running", "waiting_media"] } })) throw workbenchError("请等待项目任务结束后再删除资料", 409);
  const file = await StoredFile.findOne({ userId, ownerType: "project", ownerId: projectId, kind: { $in: ["project-document", "project-media"] }, fileId });
  if (!file) throw workbenchError("项目文件不存在", 404);
  await WorkspaceDocument.deleteOne({ userId, projectId, fileId });
  await deleteStoredFileDocument(file);
}

function tableData(columns, rows) {
  if (!Array.isArray(columns) || !columns.length || columns.length > 100 || columns.some((column) => typeof column !== "string" || !column.trim() || column.length > 200)) throw workbenchError("表格必须提供 1 至 100 个列名");
  if (!Array.isArray(rows) || rows.length > 10000) throw workbenchError("表格最多支持 1 万行");
  let size = 0;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== columns.length) throw workbenchError("每行数据的数量必须与列名一致");
    for (const cell of row) {
      if (cell !== null && !["string", "number", "boolean"].includes(typeof cell) || typeof cell === "number" && !Number.isFinite(cell)) throw workbenchError("单元格只支持文字、数字、布尔值或空值");
      size += String(cell ?? "").length;
      if (size > MAX_TEXT || typeof cell === "string" && cell.length > 32767) throw workbenchError("表格内容过长");
    }
  }
  return { columns, rows };
}

export async function createTaskArtifact({ userId, projectId = null, conversationId, taskId, name, format, content, columns, rows }) {
  const mediaWriteLease = await beginMediaWriteLease(userId);
  try {
    return await createLeasedTaskArtifact({ userId, projectId, conversationId, taskId, name, format, content, columns, rows, mediaWriteLease });
  } finally { await endMediaWriteLease(mediaWriteLease); }
}

async function createLeasedTaskArtifact({ userId, projectId, conversationId, taskId, name, format, content, columns, rows, mediaWriteLease }) {
  await requireResourceScope({ userId, projectId, conversationId });
  requireObjectId(conversationId);
  requireObjectId(taskId);
  if (!await WorkbenchTask.exists({ _id: taskId, userId, projectId, conversationId })) throw workbenchError("任务不存在", 404);
  if (!["docx", "md", "xlsx", "csv"].includes(format)) throw workbenchError("导出支持 Word、Markdown、Excel 和 CSV");
  if (typeof name !== "string" || !name.trim() || name.length > 180 || /[\x00-\x1f/\\]/.test(name)) throw workbenchError("文件名称不正确");
  let input;
  if (format === "md" || format === "docx") {
    if (typeof content !== "string" || !content.trim() || content.length > MAX_TEXT) throw workbenchError("报告内容不能为空且最多 200 万字");
    if (format === "md") input = Buffer.from(content, "utf8");
    else {
      const paragraphs = content.split(/\r?\n/).map((line) => {
        const heading = /^(#{1,3})\s+(.+)$/.exec(line);
        return new Paragraph(heading ? { text: heading[2], heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][heading[1].length - 1] } : { text: line });
      });
      const document = new Document({ sections: [{ properties: {}, children: paragraphs }] });
      input = await Packer.toBuffer(document);
    }
  } else {
    const table = tableData(columns, rows);
    if (format === "csv") {
      const escape = (value) => {
        const text = String(value ?? "");
        if (/^[\s]*[=+@-]/.test(text) && typeof value === "string") throw workbenchError("CSV 不支持以公式符号开头的文字，请改用 Excel 格式");
        return `"${text.replaceAll('"', '""')}"`;
      };
      input = Buffer.from("\uFEFF" + [table.columns, ...table.rows].map((row) => row.map(escape).join(",")).join("\r\n"), "utf8");
    } else {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("数据");
      sheet.addRow(table.columns);
      sheet.addRows(table.rows);
      sheet.getRow(1).font = { bold: true };
      sheet.views = [{ state: "frozen", ySplit: 1 }];
      sheet.columns.forEach((column) => { column.width = 22; });
      input = Buffer.from(await workbook.xlsx.writeBuffer());
    }
  }
  if (input.length > MAX_DOCUMENT_BYTES) throw workbenchError("导出文件超过 20MB");
  const originalName = name.endsWith(`.${format}`) ? name : `${name}.${format}`;
  await assertMediaWriteLeaseActive(mediaWriteLease);
  const indexed = indexArtifact({ format, content, columns, rows });
  const stored = await createStoredFile({ userId, input, originalName, extension: format, mimeType: TYPES[format], category: "document", kind: "task-artifact", ownerType: "task", ownerId: taskId, mediaWriteLease });
  try { await WorkspaceDocument.create({ userId, projectId, conversationId, fileId: stored.fileId, ...indexed }); }
  catch (error) { await deleteStoredFileDocument(stored); throw error; }
  return serializeStoredFile(stored);
}

function indexArtifact({ format, content, columns, rows }) {
  const chunks = [], tables = [];
  function add(locator, value) {
    const text = String(value).trim();
    for (let offset = 0; offset < text.length; offset += 4000) {
      chunks.push({ locator: text.length > 4000 ? `${locator}（第 ${Math.floor(offset / 4000) + 1} 段）` : locator, text: text.slice(offset, offset + 4000) });
      if (chunks.length > 12000) throw workbenchError("导出内容段落过多，请拆分成果");
    }
  }
  if (format === "md" || format === "docx") {
    content.split(/\r?\n/).forEach((line, index) => {
      add(`第 ${index + 1} ${format === "docx" ? "段" : "行"}`, format === "docx" ? line.replace(/^#{1,3}\s+/, "") : line);
    });
  } else {
    if ((rows.length + 1) * columns.length > 200000) throw workbenchError("导出表格最多支持 20 万个单元格");
    const name = format === "csv" ? "CSV" : "数据";
    const values = [columns, ...rows].map(row => row.map(value => format === "csv" ? String(value ?? "") : value));
    tables.push({ name, rows: values.map((row, index) => ({ rowNumber: index + 1, values: row })) });
    values.forEach((row, index) => add(`工作表「${name}」第 ${index + 1} 行`, row.join("\t")));
  }
  return { chunks, tables };
}
