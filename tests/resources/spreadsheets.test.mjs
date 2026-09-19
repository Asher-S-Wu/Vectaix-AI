import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { Worker } from 'node:worker_threads';
import ExcelJS from 'exceljs';

test('Excel 文件保留中文、公式结果和样式，文档解析器可读取导出的内容', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('数据');
  sheet.addRow(['名称', '金额', '合计']);
  sheet.addRow(['中文,引号"和换行\n第二行', 42, { formula: 'B2*2', result: 84 }]);
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(buffer);
  assert.equal(loaded.getWorksheet('数据').getCell('C2').result, 84);
  assert.equal(loaded.getWorksheet('数据').getRow(1).font.bold, true);
  assert.equal(loaded.getWorksheet('数据').views[0].ySplit, 1);

  const worker = new Worker(new URL('../../lib/server/workbench/documentParser.cjs', import.meta.url), {
    workerData: { buffer, extension: 'xlsx' },
  });
  try {
    const parsed = await new Promise((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.once('exit', code => { if (code !== 0) reject(new Error(`文档解析进程退出：${code}`)); });
    });
    assert.equal(parsed.error, undefined);
    assert.deepEqual(parsed.tables[0].rows[1].values, ['中文,引号"和换行\n第二行', 42, 84]);
  } finally {
    await worker.terminate();
  }
});

test('流式导出的 Excel 文件可通过项目使用的完整工作簿接口读取', async () => {
  const writer = new ExcelJS.stream.xlsx.WorkbookWriter({ useSharedStrings: true, useStyles: true });
  const sheet = writer.addWorksheet('流式数据');
  sheet.addRow(['名称', '数量']).commit();
  sheet.addRow(['测试数据', 123]).commit();
  sheet.commit();
  await writer.commit();
  const reader = new ExcelJS.Workbook();
  await reader.xlsx.load(writer.stream.toBuffer());
  const rows = [];
  reader.getWorksheet('流式数据').eachRow(row => rows.push(row.values.slice(1)));
  assert.deepEqual(rows, [['名称', '数量'], ['测试数据', 123]]);
});

test('升级 CSV 依赖后仍正确读写引号、逗号、换行和数字', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('数据');
  sheet.addRows([['名称', '数量'], ['中文,"引号"\n第二行', 123]]);
  const csv = await workbook.csv.writeBuffer();
  const loaded = new ExcelJS.Workbook();
  const parsed = await loaded.csv.read(Readable.from([csv]));
  assert.deepEqual(parsed.getRow(1).values.slice(1), ['名称', '数量']);
  assert.deepEqual(parsed.getRow(2).values.slice(1), ['中文,"引号"\n第二行', 123]);
});
