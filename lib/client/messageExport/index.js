import { getBrandAssets } from "@/lib/client/messageExport/assets";
import {
  buildFileName,
  downloadBlob,
  formatExportTime,
  normalizeExportText,
} from "@/lib/client/messageExport/file";

const BRAND_TITLE = "Vectaix AI";
const EXPORT_SUBTITLE = "AI 回复导出";
const PAGE_WIDTH = 1240;
const PAGE_HEIGHT = 1754;
const PDF_WIDTH = 595;
const PDF_HEIGHT = 842;
const PAGE_PADDING_X = 96;
const PAGE_BOTTOM = PAGE_HEIGHT - 126;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_PADDING_X * 2;
const FONT_STACK = '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
const MONO_FONT_STACK = '"Cascadia Mono", Consolas, monospace';

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("品牌图标加载失败"));
    image.src = src;
  });
}

function isBlankLine(line) {
  return !String(line || "").trim();
}

function isFenceStart(line) {
  return String(line || "").match(/^\s*(```+|~~~+)\s*([^`]*)$/);
}

function isHeadingLine(line) {
  return String(line || "").match(/^(#{1,6})\s+(.*)$/);
}

function isRuleLine(line) {
  return /^\s*((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})\s*$/.test(String(line || ""));
}

function isQuoteLine(line) {
  return /^\s*>\s?/.test(String(line || ""));
}

function matchBulletItem(line) {
  return String(line || "").match(/^\s*[-*+]\s+(.*)$/);
}

function matchOrderedItem(line) {
  return String(line || "").match(/^\s*\d+\.\s+(.*)$/);
}

function isTableSeparatorLine(line) {
  return /^\s*\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(String(line || ""));
}

function splitTableRow(line) {
  let value = String(line || "").trim();
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|")) value = value.slice(0, -1);
  return value.split("|").map((cell) => cell.trim());
}

function parseInlineTokens(text) {
  const input = String(text || "");
  const tokens = [];
  let buffer = "";
  let index = 0;

  const flush = () => {
    if (buffer) {
      tokens.push({ text: buffer });
      buffer = "";
    }
  };

  while (index < input.length) {
    if (input.startsWith("**", index) || input.startsWith("__", index)) {
      const marker = input.slice(index, index + 2);
      const end = input.indexOf(marker, index + 2);
      if (end !== -1) {
        flush();
        tokens.push({ text: input.slice(index + 2, end), bold: true });
        index = end + 2;
        continue;
      }
    }

    if (input.startsWith("~~", index)) {
      const end = input.indexOf("~~", index + 2);
      if (end !== -1) {
        flush();
        tokens.push({ text: input.slice(index + 2, end), strike: true });
        index = end + 2;
        continue;
      }
    }

    if (input[index] === "`") {
      const end = input.indexOf("`", index + 1);
      if (end !== -1) {
        flush();
        tokens.push({ text: input.slice(index + 1, end), code: true });
        index = end + 1;
        continue;
      }
    }

    if (input[index] === "[") {
      const closeLabel = input.indexOf("]", index + 1);
      if (closeLabel !== -1 && input[closeLabel + 1] === "(") {
        const closeUrl = input.indexOf(")", closeLabel + 2);
        if (closeUrl !== -1) {
          flush();
          tokens.push({
            text: input.slice(index + 1, closeLabel),
            href: input.slice(closeLabel + 2, closeUrl),
          });
          index = closeUrl + 1;
          continue;
        }
      }
    }

    if (input[index] === "*" || input[index] === "_") {
      const marker = input[index];
      const end = input.indexOf(marker, index + 1);
      if (end !== -1) {
        flush();
        tokens.push({ text: input.slice(index + 1, end), italic: true });
        index = end + 1;
        continue;
      }
    }

    buffer += input[index];
    index += 1;
  }

  flush();
  return tokens;
}

function inlineToPlainText(text) {
  return parseInlineTokens(text)
    .map((token) => (token.href ? `${token.text} (${token.href})` : token.text))
    .join("");
}

function isSpecialBlockStart(lines, index) {
  const line = lines[index];
  if (line == null) return false;
  if (isBlankLine(line)) return true;
  if (isFenceStart(line)) return true;
  if (isHeadingLine(line)) return true;
  if (isRuleLine(line)) return true;
  if (isQuoteLine(line)) return true;
  if (matchBulletItem(line) || matchOrderedItem(line)) return true;
  if (lines[index + 1] && String(line).includes("|") && isTableSeparatorLine(lines[index + 1])) return true;
  return false;
}

function parseMarkdownBlocks(content) {
  const lines = normalizeExportText(content).split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (isBlankLine(line)) {
      index += 1;
      continue;
    }

    const fenceStart = isFenceStart(line);
    if (fenceStart) {
      const marker = fenceStart[1];
      const language = String(fenceStart[2] || "").trim();
      const codeLines = [];
      index += 1;
      while (index < lines.length && !String(lines[index]).trim().startsWith(marker)) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", language, content: codeLines.join("\n") });
      continue;
    }

    const headingMatch = isHeadingLine(line);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: Math.min(6, headingMatch[1].length),
        text: headingMatch[2].trim(),
      });
      index += 1;
      continue;
    }

    if (isRuleLine(line)) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }

    if (String(line).includes("|") && lines[index + 1] && isTableSeparatorLine(lines[index + 1])) {
      const header = splitTableRow(line);
      const rows = [];
      index += 2;
      while (index < lines.length && !isBlankLine(lines[index]) && String(lines[index]).includes("|")) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }

    if (isQuoteLine(line)) {
      const quoteLines = [];
      while (index < lines.length && isQuoteLine(lines[index])) {
        quoteLines.push(String(lines[index]).replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "quote", text: quoteLines.join("\n") });
      continue;
    }

    const bulletMatch = matchBulletItem(line);
    const orderedMatch = matchOrderedItem(line);
    if (bulletMatch || orderedMatch) {
      const ordered = Boolean(orderedMatch);
      const items = [];
      let current = (orderedMatch || bulletMatch)[1].trim();
      index += 1;

      while (index < lines.length) {
        const nextLine = lines[index];
        if (isBlankLine(nextLine)) {
          index += 1;
          break;
        }

        const sameTypeMatch = ordered ? matchOrderedItem(nextLine) : matchBulletItem(nextLine);
        const otherTypeMatch = ordered ? matchBulletItem(nextLine) : matchOrderedItem(nextLine);

        if (sameTypeMatch) {
          items.push(current.trim());
          current = sameTypeMatch[1].trim();
          index += 1;
          continue;
        }

        if (otherTypeMatch || isFenceStart(nextLine) || isHeadingLine(nextLine) || isQuoteLine(nextLine) || isRuleLine(nextLine)) {
          break;
        }

        if (String(nextLine).includes("|") && lines[index + 1] && isTableSeparatorLine(lines[index + 1])) {
          break;
        }

        current += ` ${String(nextLine).trim()}`;
        index += 1;
      }

      items.push(current.trim());
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const paragraphLines = [line.trim()];
    index += 1;
    while (index < lines.length && !isSpecialBlockStart(lines, index)) {
      paragraphLines.push(String(lines[index]).trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraphLines.join(" ") });
  }

  return blocks;
}

function createCanvasPage() {
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_WIDTH;
  canvas.height = PAGE_HEIGHT;
  return canvas;
}

function createRoundedPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function fillRoundedRect(ctx, x, y, width, height, radius, fillStyle) {
  ctx.save();
  ctx.fillStyle = fillStyle;
  createRoundedPath(ctx, x, y, width, height, radius);
  ctx.fill();
  ctx.restore();
}

function strokeRoundedRect(ctx, x, y, width, height, radius, strokeStyle, lineWidth = 1) {
  ctx.save();
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  createRoundedPath(ctx, x, y, width, height, radius);
  ctx.stroke();
  ctx.restore();
}

function wrapText(ctx, text, maxWidth) {
  const lines = [];
  const rawLines = String(text || "").split("\n");

  for (const rawLine of rawLines) {
    if (!rawLine) {
      lines.push("");
      continue;
    }

    let current = "";
    for (const char of rawLine) {
      const next = current + char;
      if (current && ctx.measureText(next).width > maxWidth) {
        lines.push(current);
        current = char === " " ? "" : char;
        continue;
      }
      current = next;
    }
    lines.push(current);
  }

  return lines.length > 0 ? lines : [""];
}

function flattenCellText(value) {
  return inlineToPlainText(value).trim();
}

function createPdfDocument(icon, exportedAt) {
  const pages = [];
  let canvas = null;
  let ctx = null;
  let pageNumber = 0;
  let cursorY = 0;

  const drawPageChrome = (firstPage) => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);

    const gradient = ctx.createLinearGradient(0, 0, PAGE_WIDTH, 220);
    gradient.addColorStop(0, "#eef5ff");
    gradient.addColorStop(0.55, "#f8fbff");
    gradient.addColorStop(1, "#ffffff");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, PAGE_WIDTH, firstPage ? 300 : 170);

    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#c7dcff";
    ctx.beginPath();
    ctx.arc(PAGE_WIDTH - 110, 90, 120, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(PAGE_WIDTH - 250, 40, 64, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (firstPage) {
      fillRoundedRect(ctx, PAGE_PADDING_X, 64, CONTENT_WIDTH, 174, 28, "rgba(255,255,255,0.92)");
      strokeRoundedRect(ctx, PAGE_PADDING_X, 64, CONTENT_WIDTH, 174, 28, "#dbe7f7", 2);

      fillRoundedRect(ctx, PAGE_PADDING_X + 26, 92, 86, 86, 22, "#f2f7ff");
      ctx.drawImage(icon, PAGE_PADDING_X + 37, 103, 64, 64);

      ctx.fillStyle = "#0f172a";
      ctx.font = `700 58px ${FONT_STACK}`;
      ctx.textBaseline = "top";
      ctx.fillText(BRAND_TITLE, PAGE_PADDING_X + 140, 92);

      ctx.fillStyle = "#52637a";
      ctx.font = `400 28px ${FONT_STACK}`;
      ctx.fillText(EXPORT_SUBTITLE, PAGE_PADDING_X + 144, 156);

      fillRoundedRect(ctx, PAGE_PADDING_X + 140, 208, 246, 40, 20, "#eef4ff");
      ctx.fillStyle = "#36598c";
      ctx.font = `500 20px ${FONT_STACK}`;
      ctx.fillText(`导出时间  ${formatExportTime(exportedAt)}`, PAGE_PADDING_X + 162, 218);
    } else {
      fillRoundedRect(ctx, PAGE_PADDING_X, 40, CONTENT_WIDTH, 84, 22, "rgba(255,255,255,0.9)");
      strokeRoundedRect(ctx, PAGE_PADDING_X, 40, CONTENT_WIDTH, 84, 22, "#e4edf8", 2);
      fillRoundedRect(ctx, PAGE_PADDING_X + 18, 56, 50, 50, 14, "#f2f7ff");
      ctx.drawImage(icon, PAGE_PADDING_X + 25, 63, 36, 36);
      ctx.fillStyle = "#0f172a";
      ctx.font = `700 28px ${FONT_STACK}`;
      ctx.textBaseline = "top";
      ctx.fillText(BRAND_TITLE, PAGE_PADDING_X + 84, 62);
      ctx.fillStyle = "#64748b";
      ctx.font = `400 18px ${FONT_STACK}`;
      ctx.fillText(EXPORT_SUBTITLE, PAGE_PADDING_X + 86, 92);
    }

    ctx.strokeStyle = "#e5edf7";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(PAGE_PADDING_X, firstPage ? 270 : 144);
    ctx.lineTo(PAGE_WIDTH - PAGE_PADDING_X, firstPage ? 270 : 144);
    ctx.stroke();

    ctx.fillStyle = "#8fa0b7";
    ctx.font = `400 20px ${FONT_STACK}`;
    ctx.textAlign = "right";
    ctx.fillText(`第 ${pageNumber} 页`, PAGE_WIDTH - PAGE_PADDING_X, PAGE_HEIGHT - 72);
    ctx.textAlign = "left";
  };

  const startPage = (firstPage) => {
    canvas = createCanvasPage();
    ctx = canvas.getContext("2d");
    pageNumber += 1;
    drawPageChrome(firstPage);
    cursorY = firstPage ? 320 : 176;
  };

  startPage(true);

  return {
    get ctx() {
      return ctx;
    },
    get y() {
      return cursorY;
    },
    set y(value) {
      cursorY = value;
    },
    newPage() {
      pages.push(canvas);
      startPage(false);
    },
    finish() {
      pages.push(canvas);
      return pages;
    },
  };
}

function ensurePageSpace(pdf, neededHeight) {
  if (pdf.y + neededHeight > PAGE_BOTTOM) {
    pdf.newPage();
  }
}

function drawWrappedLines(pdf, text, options = {}) {
  const ctx = pdf.ctx;
  const x = options.x ?? PAGE_PADDING_X;
  const width = options.width ?? CONTENT_WIDTH;
  const lineHeight = options.lineHeight ?? 42;
  const color = options.color ?? "#1e293b";
  const font = options.font ?? `400 28px ${FONT_STACK}`;
  const spacingAfter = options.spacingAfter ?? 18;
  const lines = wrapText(ctx, text, width);

  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = "top";

  for (const line of lines) {
    ensurePageSpace(pdf, lineHeight + 10);
    if (line) {
      ctx.fillText(line, x, pdf.y);
    }
    pdf.y += lineHeight;
  }

  pdf.y += spacingAfter;
}

function drawParagraphBlock(pdf, text) {
  drawWrappedLines(pdf, inlineToPlainText(text), {
    font: `400 28px ${FONT_STACK}`,
    lineHeight: 42,
    spacingAfter: 20,
    color: "#1f2937",
  });
}

function drawHeadingBlock(pdf, block) {
  const sizeMap = { 1: 46, 2: 40, 3: 34, 4: 30, 5: 26, 6: 24 };
  const lineMap = { 1: 58, 2: 50, 3: 44, 4: 40, 5: 36, 6: 34 };
  const leftBarHeight = block.level <= 2 ? lineMap[block.level] - 8 : 0;
  ensurePageSpace(pdf, lineMap[block.level] + 40);

  if (leftBarHeight) {
    fillRoundedRect(pdf.ctx, PAGE_PADDING_X, pdf.y + 6, 8, leftBarHeight, 4, "#5b8def");
  }

  drawWrappedLines(pdf, inlineToPlainText(block.text), {
    x: PAGE_PADDING_X + (leftBarHeight ? 24 : 0),
    width: CONTENT_WIDTH - (leftBarHeight ? 24 : 0),
    font: `700 ${sizeMap[block.level]}px ${FONT_STACK}`,
    lineHeight: lineMap[block.level],
    spacingAfter: block.level <= 2 ? 14 : 12,
    color: "#0f172a",
  });
}

function drawRuleBlock(pdf) {
  ensurePageSpace(pdf, 22);
  pdf.ctx.strokeStyle = "#d9e6f5";
  pdf.ctx.lineWidth = 2;
  pdf.ctx.beginPath();
  pdf.ctx.moveTo(PAGE_PADDING_X, pdf.y + 6);
  pdf.ctx.lineTo(PAGE_WIDTH - PAGE_PADDING_X, pdf.y + 6);
  pdf.ctx.stroke();
  pdf.y += 22;
}

function drawListBlock(pdf, block) {
  const ctx = pdf.ctx;
  ctx.font = `400 27px ${FONT_STACK}`;
  ctx.textBaseline = "top";

  block.items.forEach((item, itemIndex) => {
    const marker = block.ordered ? `${itemIndex + 1}.` : "•";
    const x = PAGE_PADDING_X + 14;
    const textX = PAGE_PADDING_X + 48;
    const width = CONTENT_WIDTH - 48;
    const lines = wrapText(ctx, inlineToPlainText(item), width);
    const lineHeight = 40;
    const totalHeight = Math.max(lineHeight, lines.length * lineHeight) + 10;
    ensurePageSpace(pdf, totalHeight);

    ctx.fillStyle = block.ordered ? "#335c9b" : "#5b8def";
    ctx.font = `600 26px ${FONT_STACK}`;
    ctx.fillText(marker, x, pdf.y + 2);

    ctx.fillStyle = "#1f2937";
    ctx.font = `400 27px ${FONT_STACK}`;
    lines.forEach((line) => {
      if (line) ctx.fillText(line, textX, pdf.y);
      pdf.y += lineHeight;
    });
    pdf.y += 8;
  });

  pdf.y += 8;
}

function drawQuoteBlock(pdf, block) {
  const ctx = pdf.ctx;
  ctx.font = `400 26px ${FONT_STACK}`;
  const lines = wrapText(ctx, inlineToPlainText(block.text), CONTENT_WIDTH - 72);
  const lineHeight = 38;
  let start = 0;

  while (start < lines.length) {
    const available = PAGE_BOTTOM - pdf.y - 28;
    const fitCount = Math.max(1, Math.floor((available - 28) / lineHeight));
    const chunk = lines.slice(start, start + fitCount);
    const boxHeight = 26 + chunk.length * lineHeight + 18;
    ensurePageSpace(pdf, boxHeight + 8);

    fillRoundedRect(ctx, PAGE_PADDING_X, pdf.y, CONTENT_WIDTH, boxHeight, 22, "#f8fbff");
    fillRoundedRect(ctx, PAGE_PADDING_X + 18, pdf.y + 16, 6, boxHeight - 32, 3, "#7da9ff");
    strokeRoundedRect(ctx, PAGE_PADDING_X, pdf.y, CONTENT_WIDTH, boxHeight, 22, "#dde9fb", 2);

    ctx.fillStyle = "#32465f";
    ctx.font = `400 26px ${FONT_STACK}`;
    let lineY = pdf.y + 16;
    for (const line of chunk) {
      if (line) ctx.fillText(line, PAGE_PADDING_X + 42, lineY);
      lineY += lineHeight;
    }

    pdf.y += boxHeight + 14;
    start += chunk.length;
  }
}

function drawCodeBlock(pdf, block) {
  const ctx = pdf.ctx;
  ctx.font = `400 24px ${MONO_FONT_STACK}`;
  const lines = wrapText(ctx, block.content || "", CONTENT_WIDTH - 54);
  const lineHeight = 34;
  const label = block.language ? block.language.toUpperCase() : "CODE";
  let start = 0;
  let firstChunk = true;

  while (start < lines.length || (lines.length === 0 && firstChunk)) {
    const available = PAGE_BOTTOM - pdf.y - 24;
    const reservedTop = firstChunk ? 54 : 24;
    const fitCount = Math.max(1, Math.floor((available - reservedTop - 18) / lineHeight));
    const chunk = lines.length === 0 ? [""] : lines.slice(start, start + fitCount);
    const boxHeight = reservedTop + chunk.length * lineHeight + 16;
    ensurePageSpace(pdf, boxHeight + 10);

    fillRoundedRect(ctx, PAGE_PADDING_X, pdf.y, CONTENT_WIDTH, boxHeight, 24, "#0f172a");
    fillRoundedRect(ctx, PAGE_PADDING_X + 18, pdf.y + 16, 120, 30, 15, firstChunk ? "#1e293b" : "#172233");
    ctx.fillStyle = "#dbeafe";
    ctx.font = `600 16px ${FONT_STACK}`;
    ctx.fillText(firstChunk ? label : `${label} (继续)`, PAGE_PADDING_X + 34, pdf.y + 23);

    ctx.fillStyle = "#e5eefc";
    ctx.font = `400 24px ${MONO_FONT_STACK}`;
    let lineY = pdf.y + reservedTop;
    for (const line of chunk) {
      if (line) ctx.fillText(line, PAGE_PADDING_X + 26, lineY);
      lineY += lineHeight;
    }

    pdf.y += boxHeight + 16;
    start += chunk.length;
    firstChunk = false;
    if (lines.length === 0) break;
  }
}

function getTableColumnWidths(table) {
  const rows = [table.header, ...table.rows];
  const colCount = Math.max(...rows.map((row) => row.length));
  const weights = new Array(colCount).fill(1);

  rows.forEach((row) => {
    for (let i = 0; i < colCount; i += 1) {
      const value = flattenCellText(row[i] || "");
      weights[i] = Math.max(weights[i], Math.min(8, Math.max(1, value.length / 12)));
    }
  });

  const total = weights.reduce((sum, item) => sum + item, 0);
  return weights.map((weight) => Math.round((CONTENT_WIDTH / total) * weight));
}

function drawTableRow(ctx, row, x, y, widths, options = {}) {
  const font = options.font || `400 24px ${FONT_STACK}`;
  const lineHeight = options.lineHeight || 32;
  const fill = options.fill || "#ffffff";
  const border = options.border || "#dbe4f0";
  const textColor = options.textColor || "#1f2937";

  ctx.font = font;
  const cellLines = widths.map((width, columnIndex) => wrapText(ctx, flattenCellText(row[columnIndex] || ""), width - 24));
  const rowHeight = Math.max(...cellLines.map((lines) => Math.max(1, lines.length))) * lineHeight + 24;

  let offsetX = x;
  for (let i = 0; i < widths.length; i += 1) {
    fillRoundedRect(ctx, offsetX, y, widths[i] - 4, rowHeight, 12, fill);
    strokeRoundedRect(ctx, offsetX, y, widths[i] - 4, rowHeight, 12, border, 1.5);
    ctx.fillStyle = textColor;
    let textY = y + 12;
    for (const line of cellLines[i]) {
      if (line) ctx.fillText(line, offsetX + 12, textY);
      textY += lineHeight;
    }
    offsetX += widths[i];
  }

  return rowHeight;
}

function measureTableRowHeight(ctx, row, widths, options = {}) {
  const font = options.font || `400 24px ${FONT_STACK}`;
  const lineHeight = options.lineHeight || 32;
  ctx.font = font;
  const cellLines = widths.map((width, columnIndex) => wrapText(ctx, flattenCellText(row[columnIndex] || ""), width - 24));
  return Math.max(...cellLines.map((lines) => Math.max(1, lines.length))) * lineHeight + 24;
}

function drawTableBlock(pdf, table) {
  const ctx = pdf.ctx;
  const widths = getTableColumnWidths(table);
  const x = PAGE_PADDING_X;

  const drawHeader = () => {
    ctx.font = `600 24px ${FONT_STACK}`;
    return drawTableRow(ctx, table.header, x, pdf.y, widths, {
      font: `600 24px ${FONT_STACK}`,
      lineHeight: 32,
      fill: "#eef4ff",
      border: "#cfdcf4",
      textColor: "#173152",
    });
  };

  ensurePageSpace(pdf, 80);
  let headerHeight = drawHeader();
  pdf.y += headerHeight + 10;

  table.rows.forEach((row, rowIndex) => {
    const tempHeight = measureTableRowHeight(ctx, row, widths, {
      font: `400 23px ${FONT_STACK}`,
      lineHeight: 30,
      fill: rowIndex % 2 === 0 ? "#ffffff" : "#f9fbff",
      border: "#dde6f2",
    });
    if (pdf.y + tempHeight > PAGE_BOTTOM) {
      pdf.newPage();
      headerHeight = drawHeader();
      pdf.y += headerHeight + 10;
    }
    const rowHeight = drawTableRow(ctx, row, x, pdf.y, widths, {
      font: `400 23px ${FONT_STACK}`,
      lineHeight: 30,
      fill: rowIndex % 2 === 0 ? "#ffffff" : "#f9fbff",
      border: "#dde6f2",
    });
    pdf.y += rowHeight + 8;
  });

  pdf.y += 10;
}

async function buildPdfBlob(blocks, exportedAt) {
  const { dataUrl } = await getBrandAssets();
  const icon = await loadImage(dataUrl);
  if (document.fonts?.ready) {
    await document.fonts.ready;
  }

  const pdf = createPdfDocument(icon, exportedAt);

  blocks.forEach((block) => {
    if (block.type === "heading") drawHeadingBlock(pdf, block);
    else if (block.type === "paragraph") drawParagraphBlock(pdf, block.text);
    else if (block.type === "rule") drawRuleBlock(pdf);
    else if (block.type === "list") drawListBlock(pdf, block);
    else if (block.type === "quote") drawQuoteBlock(pdf, block);
    else if (block.type === "code") drawCodeBlock(pdf, block);
    else if (block.type === "table") drawTableBlock(pdf, block);
  });

  const pages = pdf.finish();
  const jpegPages = pages.map((page) => dataUrlToBytes(page.toDataURL("image/jpeg", 0.92)));
  return buildPdfFromImages(jpegPages);
}

function dataUrlToBytes(dataUrl) {
  const base64 = String(dataUrl || "").split(",")[1] || "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function joinUint8Arrays(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

function createAsciiBytes(value) {
  return new TextEncoder().encode(value);
}

function buildPdfFromImages(pageImages) {
  const header = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 37, 255, 255, 255, 255, 10]);
  const objectCount = 2 + pageImages.length * 3;
  const pageObjectNumbers = [];
  const imageObjectNumbers = [];
  const contentObjectNumbers = [];
  let objectNumber = 3;

  for (let i = 0; i < pageImages.length; i += 1) {
    imageObjectNumbers.push(objectNumber);
    contentObjectNumbers.push(objectNumber + 1);
    pageObjectNumbers.push(objectNumber + 2);
    objectNumber += 3;
  }

  const offsets = new Array(objectCount + 1).fill(0);
  const chunks = [header];
  let offset = header.length;

  const pushBytes = (bytes) => {
    chunks.push(bytes);
    offset += bytes.length;
  };

  const pushObject = (number, parts) => {
    offsets[number] = offset;
    pushBytes(createAsciiBytes(`${number} 0 obj\n`));
    for (const part of parts) {
      pushBytes(typeof part === "string" ? createAsciiBytes(part) : part);
    }
    pushBytes(createAsciiBytes("\nendobj\n"));
  };

  pushObject(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  pushObject(2, [`<< /Type /Pages /Count ${pageImages.length} /Kids [${pageObjectNumbers.map((num) => `${num} 0 R`).join(" ")}] >>`]);

  pageImages.forEach((imageBytes, index) => {
    const imageName = `/Im${index + 1}`;
    const contentStream = createAsciiBytes(`q\n${PDF_WIDTH} 0 0 ${PDF_HEIGHT} 0 0 cm\n${imageName} Do\nQ`);

    pushObject(imageObjectNumbers[index], [
      `<< /Type /XObject /Subtype /Image /Width ${PAGE_WIDTH} /Height ${PAGE_HEIGHT} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>\nstream\n`,
      imageBytes,
      "\nendstream",
    ]);

    pushObject(contentObjectNumbers[index], [
      `<< /Length ${contentStream.length} >>\nstream\n`,
      contentStream,
      "\nendstream",
    ]);

    pushObject(pageObjectNumbers[index], [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_WIDTH} ${PDF_HEIGHT}] /Resources << /XObject << ${imageName} ${imageObjectNumbers[index]} 0 R >> >> /Contents ${contentObjectNumbers[index]} 0 R >>`,
    ]);
  });

  const xrefOffset = offset;
  pushBytes(createAsciiBytes(`xref\n0 ${objectCount + 1}\n`));
  pushBytes(createAsciiBytes("0000000000 65535 f \n"));
  for (let i = 1; i <= objectCount; i += 1) {
    pushBytes(createAsciiBytes(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`));
  }
  pushBytes(createAsciiBytes(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`));
  return new Blob([joinUint8Arrays(chunks)], { type: "application/pdf" });
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function crc32(bytes) {
  let crc = -1;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ -1) >>> 0;
}

function writeUInt16(view, offset, value) {
  view.setUint16(offset, value, true);
}

function writeUInt32(view, offset, value) {
  view.setUint32(offset, value, true);
}

function makeZip(entries) {
  const encoder = new TextEncoder();
  const prepared = entries.map((entry) => {
    const nameBytes = encoder.encode(entry.name);
    const dataBytes = entry.data instanceof Uint8Array ? entry.data : encoder.encode(entry.data);
    return { nameBytes, dataBytes, crc: crc32(dataBytes) };
  });

  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  prepared.forEach((entry) => {
    const localHeader = new Uint8Array(30 + entry.nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    writeUInt32(localView, 0, 0x04034b50);
    writeUInt16(localView, 4, 20);
    writeUInt16(localView, 6, 0);
    writeUInt16(localView, 8, 0);
    writeUInt16(localView, 10, 0);
    writeUInt16(localView, 12, 0);
    writeUInt32(localView, 14, entry.crc);
    writeUInt32(localView, 18, entry.dataBytes.length);
    writeUInt32(localView, 22, entry.dataBytes.length);
    writeUInt16(localView, 26, entry.nameBytes.length);
    writeUInt16(localView, 28, 0);
    localHeader.set(entry.nameBytes, 30);
    localParts.push(localHeader, entry.dataBytes);

    const centralHeader = new Uint8Array(46 + entry.nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    writeUInt32(centralView, 0, 0x02014b50);
    writeUInt16(centralView, 4, 20);
    writeUInt16(centralView, 6, 20);
    writeUInt16(centralView, 8, 0);
    writeUInt16(centralView, 10, 0);
    writeUInt16(centralView, 12, 0);
    writeUInt16(centralView, 14, 0);
    writeUInt32(centralView, 16, entry.crc);
    writeUInt32(centralView, 20, entry.dataBytes.length);
    writeUInt32(centralView, 24, entry.dataBytes.length);
    writeUInt16(centralView, 28, entry.nameBytes.length);
    writeUInt16(centralView, 30, 0);
    writeUInt16(centralView, 32, 0);
    writeUInt16(centralView, 34, 0);
    writeUInt16(centralView, 36, 0);
    writeUInt32(centralView, 38, 0);
    writeUInt32(centralView, 42, localOffset);
    centralHeader.set(entry.nameBytes, 46);
    centralParts.push(centralHeader);

    localOffset += localHeader.length + entry.dataBytes.length;
  });

  const localFiles = joinUint8Arrays(localParts);
  const centralDirectory = joinUint8Arrays(centralParts);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  writeUInt32(endView, 0, 0x06054b50);
  writeUInt16(endView, 4, 0);
  writeUInt16(endView, 6, 0);
  writeUInt16(endView, 8, prepared.length);
  writeUInt16(endView, 10, prepared.length);
  writeUInt32(endView, 12, centralDirectory.length);
  writeUInt32(endView, 16, localFiles.length);
  writeUInt16(endView, 20, 0);

  return joinUint8Arrays([localFiles, centralDirectory, endRecord]);
}

function buildRunProperties(options = {}) {
  const props = [];
  if (options.bold) props.push("<w:b/><w:bCs/>");
  if (options.italic) props.push("<w:i/><w:iCs/>");
  if (options.underline) props.push('<w:u w:val="single"/>');
  if (options.strike) props.push("<w:strike/>");
  if (options.color) props.push(`<w:color w:val="${options.color}"/>`);
  if (options.fontSize) props.push(`<w:sz w:val="${options.fontSize}"/><w:szCs w:val="${options.fontSize}"/>`);
  if (options.mono) props.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Consolas"/>');
  if (options.fill) props.push(`<w:shd w:val="clear" w:fill="${options.fill}"/>`);
  return props.length ? `<w:rPr>${props.join("")}</w:rPr>` : "";
}

function buildTextRun(text, options = {}) {
  const safeText = text === "" ? " " : String(text);
  return `<w:r>${buildRunProperties(options)}<w:t xml:space="preserve">${escapeXml(safeText)}</w:t></w:r>`;
}

function buildInlineRuns(text, baseOptions = {}) {
  const tokens = parseInlineTokens(text);
  if (tokens.length === 0) {
    return buildTextRun("", baseOptions);
  }

  return tokens.map((token) => {
    const options = { ...baseOptions };
    if (token.bold) options.bold = true;
    if (token.italic) options.italic = true;
    if (token.strike) options.strike = true;
    if (token.code) {
      options.mono = true;
      options.fill = "EEF2F7";
      options.fontSize = baseOptions.fontSize || 20;
    }
    if (token.href) {
      options.color = "2563EB";
      options.underline = true;
    }
    const value = token.href ? `${token.text} (${token.href})` : token.text;
    return buildTextRun(value, options);
  }).join("");
}

function buildParagraph(runs, options = {}) {
  const pPr = [];
  if (options.styleId) pPr.push(`<w:pStyle w:val="${options.styleId}"/>`);
  if (options.align) pPr.push(`<w:jc w:val="${options.align}"/>`);
  if (Number.isFinite(options.spacingBefore) || Number.isFinite(options.spacingAfter) || Number.isFinite(options.line)) {
    const before = Number.isFinite(options.spacingBefore) ? ` w:before="${options.spacingBefore}"` : "";
    const after = Number.isFinite(options.spacingAfter) ? ` w:after="${options.spacingAfter}"` : "";
    const line = Number.isFinite(options.line) ? ` w:line="${options.line}" w:lineRule="auto"` : "";
    pPr.push(`<w:spacing${before}${after}${line}/>`);
  }
  if (options.numId) {
    pPr.push(`<w:numPr><w:ilvl w:val="${options.ilvl || 0}"/><w:numId w:val="${options.numId}"/></w:numPr>`);
  }
  if (options.indentLeft || options.indentHanging) {
    const left = options.indentLeft ? ` w:left="${options.indentLeft}"` : "";
    const hanging = options.indentHanging ? ` w:hanging="${options.indentHanging}"` : "";
    pPr.push(`<w:ind${left}${hanging}/>`);
  }
  if (options.borderBottom) {
    pPr.push(`<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="1" w:color="${options.borderBottom}"/></w:pBdr>`);
  }
  if (options.extraPPr) pPr.push(options.extraPPr);
  return `<w:p><w:pPr>${pPr.join("")}</w:pPr>${runs || "<w:r/>"}</w:p>`;
}

function buildCodeRuns(text) {
  const lines = String(text || "").split("\n");
  const runs = [];
  lines.forEach((line, index) => {
    runs.push(buildTextRun(line || " ", { mono: true, fontSize: 20, color: "E5EDF8" }));
    if (index < lines.length - 1) {
      runs.push("<w:r><w:br/></w:r>");
    }
  });
  return runs.join("");
}

function buildTableXml(table) {
  const colCount = Math.max(table.header.length, ...table.rows.map((row) => row.length));
  const colWidth = Math.floor(5000 / Math.max(1, colCount));
  const rows = [table.header, ...table.rows];

  const rowXml = rows.map((row, rowIndex) => {
    const cells = new Array(colCount).fill("").map((_, cellIndex) => {
      const fill = rowIndex === 0 ? "EEF4FF" : rowIndex % 2 === 0 ? "F9FBFF" : "FFFFFF";
      const runs = buildInlineRuns(row[cellIndex] || "", {
        fontSize: rowIndex === 0 ? 22 : 21,
        color: rowIndex === 0 ? "173152" : "1F2937",
        bold: rowIndex === 0,
      });
      return [
        `<w:tc><w:tcPr><w:tcW w:w="${colWidth}" w:type="pct"/><w:shd w:val="clear" w:fill="${fill}"/></w:tcPr>`,
        buildParagraph(runs, { spacingBefore: 0, spacingAfter: 0, line: 300 }),
        "</w:tc>",
      ].join("");
    }).join("");

    return `<w:tr>${cells}</w:tr>`;
  }).join("");

  return [
    '<w:tbl>',
    '<w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>',
    '<w:top w:val="single" w:sz="8" w:color="D9E4F1"/>',
    '<w:left w:val="single" w:sz="8" w:color="D9E4F1"/>',
    '<w:bottom w:val="single" w:sz="8" w:color="D9E4F1"/>',
    '<w:right w:val="single" w:sz="8" w:color="D9E4F1"/>',
    '<w:insideH w:val="single" w:sz="6" w:color="E3EAF4"/>',
    '<w:insideV w:val="single" w:sz="6" w:color="E3EAF4"/>',
    '</w:tblBorders><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>',
    `<w:tblGrid>${new Array(colCount).fill("").map(() => `<w:gridCol w:w="${Math.floor(9000 / Math.max(1, colCount))}"/>`).join("")}</w:tblGrid>`,
    rowXml,
    '</w:tbl>',
  ].join("");
}

function buildDocxStylesXml() {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Segoe UI" w:hAnsi="Segoe UI" w:eastAsia="Microsoft YaHei"/><w:color w:val="1F2937"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>',
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="120" w:line="340" w:lineRule="auto"/></w:pPr></w:style>',
    '<w:style w:type="paragraph" w:styleId="ExportTitle"><w:name w:val="Export Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:after="100"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="54"/><w:szCs w:val="54"/><w:color w:val="0F172A"/></w:rPr></w:style>',
    '<w:style w:type="paragraph" w:styleId="ExportSubtitle"><w:name w:val="Export Subtitle"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:after="220"/></w:pPr><w:rPr><w:sz w:val="24"/><w:szCs w:val="24"/><w:color w:val="5B6C84"/></w:rPr></w:style>',
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="220" w:after="120"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="36"/><w:szCs w:val="36"/><w:color w:val="0F172A"/></w:rPr></w:style>',
    '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="Heading 2"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="180" w:after="100"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="32"/><w:szCs w:val="32"/><w:color w:val="16324F"/></w:rPr></w:style>',
    '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="Heading 3"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="160" w:after="90"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/><w:color w:val="1F3B63"/></w:rPr></w:style>',
    '<w:style w:type="paragraph" w:styleId="QuoteBlock"><w:name w:val="Quote Block"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="80" w:after="140"/><w:ind w:left="420"/><w:pBdr><w:left w:val="single" w:sz="18" w:space="18" w:color="7DA9FF"/></w:pBdr><w:shd w:val="clear" w:fill="F8FBFF"/></w:pPr><w:rPr><w:color w:val="32465F"/></w:rPr></w:style>',
    '<w:style w:type="paragraph" w:styleId="CodeBlock"><w:name w:val="Code Block"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="120" w:after="160"/><w:shd w:val="clear" w:fill="0F172A"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Consolas"/><w:color w:val="E5EDF8"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>',
    '</w:styles>',
  ].join("");
}

function buildDocxNumberingXml() {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="260"/></w:pPr><w:rPr><w:rFonts w:ascii="Segoe UI Symbol" w:hAnsi="Segoe UI Symbol"/></w:rPr></w:lvl></w:abstractNum>',
    '<w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="260"/></w:pPr></w:lvl></w:abstractNum>',
    '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>',
    '<w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>',
    '</w:numbering>',
  ].join("");
}

function buildDocxImageParagraph() {
  return [
    '<w:p>',
    '<w:pPr><w:jc w:val="center"/><w:spacing w:after="100"/></w:pPr>',
    '<w:r>',
    '<w:drawing>',
    '<wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">',
    '<wp:extent cx="685800" cy="685800"/>',
    '<wp:docPr id="1" name="Vectaix AI Icon"/>',
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">',
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">',
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">',
    '<pic:nvPicPr><pic:cNvPr id="0" name="icon.png"/><pic:cNvPicPr/></pic:nvPicPr>',
    '<pic:blipFill><a:blip r:embed="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>',
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="685800" cy="685800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>',
    '</pic:pic>',
    '</a:graphicData>',
    '</a:graphic>',
    '</wp:inline>',
    '</w:drawing>',
    '</w:r>',
    '</w:p>',
  ].join("");
}

function buildDocxDocumentXml(blocks, exportedAt) {
  const content = [
    buildDocxImageParagraph(),
    buildParagraph(buildTextRun(BRAND_TITLE, { bold: true, fontSize: 54, color: "0F172A" }), { styleId: "ExportTitle", align: "center" }),
    buildParagraph(buildTextRun(`${EXPORT_SUBTITLE} · ${formatExportTime(exportedAt)}`, { fontSize: 24, color: "5B6C84" }), { styleId: "ExportSubtitle", align: "center" }),
    buildParagraph("", { borderBottom: "D7E2F0", spacingAfter: 180 }),
  ];

  blocks.forEach((block) => {
    if (block.type === "heading") {
      const styleId = block.level <= 1 ? "Heading1" : block.level === 2 ? "Heading2" : "Heading3";
      content.push(buildParagraph(buildInlineRuns(block.text, { fontSize: block.level <= 1 ? 36 : block.level === 2 ? 32 : 28 }), { styleId }));
      return;
    }

    if (block.type === "paragraph") {
      content.push(buildParagraph(buildInlineRuns(block.text, { fontSize: 22, color: "1F2937" }), { spacingAfter: 110, line: 340 }));
      return;
    }

    if (block.type === "rule") {
      content.push(buildParagraph("", { borderBottom: "DCE7F4", spacingAfter: 120 }));
      return;
    }

    if (block.type === "quote") {
      String(block.text || "").split("\n").forEach((line) => {
        content.push(buildParagraph(buildInlineRuns(line, { fontSize: 21, color: "32465F" }), { styleId: "QuoteBlock", line: 320 }));
      });
      return;
    }

    if (block.type === "list") {
      block.items.forEach((item) => {
        content.push(buildParagraph(buildInlineRuns(item, { fontSize: 22, color: "1F2937" }), {
          numId: block.ordered ? 2 : 1,
          ilvl: 0,
          spacingAfter: 60,
          line: 320,
        }));
      });
      content.push(buildParagraph("", { spacingAfter: 40 }));
      return;
    }

    if (block.type === "code") {
      if (block.language) {
        content.push(buildParagraph(buildTextRun(block.language.toUpperCase(), { fontSize: 18, color: "94A3B8", bold: true }), {
          spacingAfter: 40,
        }));
      }
      content.push(buildParagraph(buildCodeRuns(block.content), {
        styleId: "CodeBlock",
        spacingAfter: 150,
        line: 280,
        extraPPr: '<w:shd w:val="clear" w:fill="0F172A"/><w:ind w:left="180" w:right="180"/>',
      }));
      return;
    }

    if (block.type === "table") {
      content.push(buildTableXml(block));
      content.push(buildParagraph("", { spacingAfter: 90 }));
    }
  });

  content.push('<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>');

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" xmlns:wne="http://schemas.microsoft.com/office/2006/wordml" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" mc:Ignorable="w14 wp14">',
    '<w:body>',
    content.join(""),
    '</w:body>',
    '</w:document>',
  ].join("");
}

async function buildDocxBlob(blocks, exportedAt) {
  const { bytes } = await getBrandAssets();
  const created = exportedAt.toISOString();
  const zipBytes = makeZip([
    {
      name: "[Content_Types].xml",
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>',
    },
    {
      name: "_rels/.rels",
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>',
    },
    {
      name: "docProps/app.xml",
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Vectaix AI</Application></Properties>',
    },
    {
      name: "docProps/core.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(BRAND_TITLE)}</dc:title><dc:creator>Vectaix AI</dc:creator><cp:lastModifiedBy>Vectaix AI</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified></cp:coreProperties>`,
    },
    {
      name: "word/document.xml",
      data: buildDocxDocumentXml(blocks, exportedAt),
    },
    {
      name: "word/styles.xml",
      data: buildDocxStylesXml(),
    },
    {
      name: "word/numbering.xml",
      data: buildDocxNumberingXml(),
    },
    {
      name: "word/_rels/document.xml.rels",
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/icon.png"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>',
    },
    {
      name: "word/media/icon.png",
      data: bytes,
    },
  ]);

  return new Blob([zipBytes], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

function buildMarkdownDocument(text, exportedAt) {
  const origin = window.location.origin;
  return [
    '<div align="center">',
    `  <img src="${origin}/icon" alt="${BRAND_TITLE}" width="72" height="72" />`,
    `  <h1>${BRAND_TITLE}</h1>`,
    `  <p>${EXPORT_SUBTITLE}</p>`,
    '</div>',
    '',
    `> 导出时间：${formatExportTime(exportedAt)}`,
    '',
    '---',
    '',
    text,
    '',
  ].join("\n");
}

export async function exportMessageContent(format, content) {
  const text = normalizeExportText(content);
  if (!text) {
    throw new Error("这条回复暂无可导出的内容");
  }

  const exportedAt = new Date();
  const blocks = parseMarkdownBlocks(text);

  if (format === "markdown") {
    downloadBlob(
      new Blob([buildMarkdownDocument(text, exportedAt)], { type: "text/markdown;charset=utf-8" }),
      buildFileName("md", exportedAt),
    );
    return;
  }

  if (format === "pdf") {
    const blob = await buildPdfBlob(blocks, exportedAt);
    downloadBlob(blob, buildFileName("pdf", exportedAt));
    return;
  }

  if (format === "docx") {
    const blob = await buildDocxBlob(blocks, exportedAt);
    downloadBlob(blob, buildFileName("docx", exportedAt));
    return;
  }

  throw new Error("不支持的导出格式");
}
