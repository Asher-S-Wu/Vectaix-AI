const { parentPort, workerData } = require("node:worker_threads");
const yauzl = require("yauzl");
const mammoth = require("mammoth");
const ExcelJS = require("exceljs");
const { parse } = require("csv-parse/sync");
const MAX_TEXT = 2_000_000;
const MAX_CHUNKS = 10_000;
function workbenchError(message, status = 400) { return Object.assign(new Error(message), { status }); }

// Read every ZIP entry with measured output limits before an Office parser sees it.
async function inspectOfficeArchive(buffer, extension) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error) return reject(workbenchError("文档损坏或格式不正确"));
      let entries = 0;
      let declared = 0;
      let measured = 0;
      let requiredPart = false;
      let failed = false;
      const fail = () => {
        if (failed) return;
        failed = true;
        zip.close();
        reject(workbenchError("文档损坏、已加密或解压内容超过限制"));
      };
      zip.on("error", fail);
      zip.on("entry", (entry) => {
        entries += 1;
        declared += entry.uncompressedSize;
        if (entries > 2000 || declared > 40 * 1024 * 1024 || entry.generalPurposeBitFlag & 1 || entry.uncompressedSize > 200 * Math.max(1, entry.compressedSize)) return fail();
        if (entry.fileName === (extension === "docx" ? "word/document.xml" : "xl/workbook.xml")) requiredPart = true;
        if (entry.fileName.endsWith("/")) return zip.readEntry();
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return fail();
          stream.on("data", (chunk) => {
            measured += chunk.length;
            if (measured > 40 * 1024 * 1024) { stream.destroy(); fail(); }
          });
          stream.on("error", fail);
          stream.on("end", () => { if (!failed) zip.readEntry(); });
        });
      });
      zip.on("end", () => {
        if (failed) return;
        if (!requiredPart) return fail();
        resolve();
      });
      zip.readEntry();
    });
  });
}

function chunkCollector() {
  const chunks = [];
  let length = 0;
  return {
    chunks,
    add(locator, value) {
      const text = String(value).trim();
      if (!text) return;
      length += text.length;
      if (length > MAX_TEXT) throw workbenchError("文档文字超过 200 万字，请拆分后上传");
      for (let index = 0; index < text.length; index += 4000) {
        chunks.push({ locator: text.length > 4000 ? `${locator}（第 ${Math.floor(index / 4000) + 1} 段）` : locator, text: text.slice(index, index + 4000) });
        if (chunks.length > MAX_CHUNKS) throw workbenchError("文档内容块过多，请拆分后上传");
      }
    },
  };
}

function decodeText(buffer) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    if (text.includes("\0")) throw new Error("binary");
    return text;
  } catch { throw workbenchError("文本文件必须为 UTF-8 编码，且不能包含二进制内容"); }
}

async function extractDocument(buffer, extension) {
  const result = chunkCollector();
  const tables = [];
  let cellCount = 0;
  function keepRow(table, rowNumber, values) {
    cellCount += values.length;
    if (cellCount > 200000) throw workbenchError("表格最多支持 20 万个单元格，请拆分后上传");
    table.rows.push({ rowNumber, values });
  }
  try {
    if (extension === "pdf") {
      if (buffer.subarray(0, 5).toString() !== "%PDF-") throw workbenchError("PDF 文件格式不正确");
      const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const loading = getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, stopAtErrors: true, maxImageSize: 0, verbosity: 0 });
      try {
        const pdf = await loading.promise;
        if (pdf.numPages > 300) throw workbenchError("PDF 最多支持 300 页，请拆分后上传");
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          const page = await pdf.getPage(pageNumber);
          const content = await page.getTextContent();
          result.add(`第 ${pageNumber} 页`, content.items.map((item) => typeof item.str === "string" ? `${item.str}${item.hasEOL ? "\n" : " "}` : "").join(""));
          page.cleanup();
        }
      } finally { await loading.destroy(); }
    } else if (extension === "docx") {
      await inspectOfficeArchive(buffer, extension);
      const { value } = await mammoth.extractRawText({ buffer });
      value.split(/\n\n/).forEach((paragraph, index) => result.add(`第 ${index + 1} 段`, paragraph));
    } else if (extension === "xlsx") {
      await inspectOfficeArchive(buffer, extension);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      if (workbook.worksheets.length > 100) throw workbenchError("工作表不能超过 100 个");
      workbook.eachSheet((sheet) => {
        if (sheet.rowCount > 50000 || sheet.columnCount > 200) throw workbenchError("工作表最多支持 5 万行、200 列");
        const table = { name: sheet.name, rows: [] };
        sheet.eachRow((row, rowNumber) => {
          const cells = [];
          for (let column = 1; column <= sheet.columnCount; column += 1) {
            const cell = row.getCell(column);
            if (cell.value === null || ["string", "number", "boolean"].includes(typeof cell.value)) cells.push(cell.value);
            else if (cell.value instanceof Date) cells.push(cell.value.toISOString());
            else if (cell.formula) {
              if (cell.result === undefined || cell.result !== null && !["string", "number", "boolean"].includes(typeof cell.result)) throw workbenchError("表格公式没有可读取的计算结果，请在 Excel 中计算并保存后上传");
              cells.push(cell.result);
            } else cells.push(cell.text);
          }
          keepRow(table, rowNumber, cells);
          result.add(`工作表「${sheet.name}」第 ${rowNumber} 行`, cells.join("\t"));
        });
        if (table.rows.length) tables.push(table);
      });
    } else if (extension === "csv") {
      const rows = parse(decodeText(buffer), { bom: true, max_record_size: 100000 });
      if (rows.length > 50000) throw workbenchError("CSV 最多支持 5 万行");
      const table = { name: "CSV", rows: [] };
      rows.forEach((row, index) => {
        if (row.length > 200) throw workbenchError("CSV 最多支持 200 列");
        keepRow(table, index + 1, row);
        result.add(`第 ${index + 1} 行`, row.join("\t"));
      });
      tables.push(table);
    } else {
      decodeText(buffer).split(/\r?\n/).forEach((line, index) => result.add(`第 ${index + 1} 行`, line));
    }
  } catch (error) {
    if (error.status) throw error;
    if (error.name === "PasswordException") throw workbenchError("暂不支持加密 PDF，请移除密码后上传");
    throw workbenchError("文档无法读取，请检查文件是否损坏或已加密");
  }
  if (!result.chunks.length) throw workbenchError(extension === "pdf" ? "未找到可读取文字，暂不支持扫描版 PDF" : "文档没有可读取的内容");
  return { chunks: result.chunks, tables };
}

extractDocument(Buffer.from(workerData.buffer), workerData.extension).then(
  (document) => parentPort.postMessage(document),
  (error) => parentPort.postMessage({ error: error.message, status: error.status || 400 }),
);
