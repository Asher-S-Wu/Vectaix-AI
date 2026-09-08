import WorkspaceDocument from '@/models/WorkspaceDocument';
import WorkbenchTask from '@/models/WorkbenchTask';
import { defineTaskTool, textParameter } from './tools';
import { createTaskArtifact, requireReadableProjectDocument } from './documents';
import { appendTaskEvent } from './events';

function columnIndex(columns, column) {
  const index = columns.indexOf(column);
  if (typeof column !== 'string' || index < 0) throw new Error(`表格中不存在列：${String(column)}`);
  return index;
}

function selectedIndices(columns, selected) {
  if (!Array.isArray(selected) || !selected.length || new Set(selected).size !== selected.length) throw new Error('请选择不重复的列名');
  return selected.map(column => columnIndex(columns, column));
}

function numeric(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) throw new Error('计算列存在空值或非数字，请先筛选整理');
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error('计算列存在非数字，请先筛选整理');
  return result;
}

function validateOperation(operation, fields) {
  if (Object.keys(operation).some(key => !fields.includes(key))) throw new Error('表格操作包含不支持的参数');
}

function transform(initial, operations, signal) {
  let columns = initial.columns.slice();
  let rows = initial.rows.map(row => row.slice());
  if (!Array.isArray(operations) || !operations.length || operations.length > 20) throw new Error('请提供 1 至 20 个表格整理操作');
  for (const operation of operations) {
    signal.throwIfAborted();
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) throw new Error('表格操作格式不正确');
    switch (operation.type) {
      case 'select': {
        validateOperation(operation, ['type', 'columns']);
        const indices = selectedIndices(columns, operation.columns);
        rows = rows.map(row => indices.map(index => row[index]));
        columns = operation.columns.slice();
        break;
      }
      case 'filter': {
        validateOperation(operation, ['type', 'column', 'operator', 'value']);
        const index = columnIndex(columns, operation.column);
        const { operator, value } = operation;
        if (!['eq', 'ne', 'contains', 'gt', 'gte', 'lt', 'lte', 'empty', 'not_empty'].includes(operator)) throw new Error('筛选条件不支持');
        if (value !== null && !['number', 'string', 'boolean'].includes(typeof value) && !['empty', 'not_empty'].includes(operator)) throw new Error('筛选值必须是文字、数字、布尔值或空值');
        rows = rows.filter(row => {
          const cell = row[index];
          if (operator === 'empty') return cell === null || cell === '';
          if (operator === 'not_empty') return cell !== null && cell !== '';
          if (operator === 'eq') return cell === value;
          if (operator === 'ne') return cell !== value;
          if (operator === 'contains') return String(cell ?? '').includes(String(value));
          const left = numeric(cell), right = numeric(value);
          return operator === 'gt' ? left > right : operator === 'gte' ? left >= right : operator === 'lt' ? left < right : left <= right;
        });
        break;
      }
      case 'sort': {
        validateOperation(operation, ['type', 'column', 'direction', 'numeric']);
        const index = columnIndex(columns, operation.column);
        if (!['asc', 'desc'].includes(operation.direction) || typeof operation.numeric !== 'boolean') throw new Error('排序须指定 asc/desc 及 numeric 开关');
        if (operation.numeric) rows.forEach(row => numeric(row[index]));
        rows.sort((left, right) => {
          const order = operation.numeric ? numeric(left[index]) - numeric(right[index]) : String(left[index] ?? '').localeCompare(String(right[index] ?? ''), 'zh-CN');
          return operation.direction === 'desc' ? -order : order;
        });
        break;
      }
      case 'deduplicate': {
        validateOperation(operation, ['type', 'columns']);
        const indices = selectedIndices(columns, operation.columns), seen = new Set();
        rows = rows.filter(row => {
          const key = JSON.stringify(indices.map(index => row[index]));
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        break;
      }
      case 'group': {
        validateOperation(operation, ['type', 'by', 'aggregations']);
        if (!Array.isArray(operation.by) || new Set(operation.by).size !== operation.by.length) throw new Error('分组列格式不正确');
        const indices = operation.by.map(column => columnIndex(columns, column));
        if (!Array.isArray(operation.aggregations) || !operation.aggregations.length || operation.aggregations.length > 20) throw new Error('分组须提供 1 至 20 个汇总项');
        const aggregations = operation.aggregations.map(item => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('汇总项格式不正确');
          validateOperation(item, ['op', 'column', 'as']);
          if (!['count', 'sum'].includes(item.op) || typeof item.as !== 'string' || !item.as.trim() || item.as.length > 200) throw new Error('汇总仅支持 count/sum，并须指定结果列名 as');
          return { ...item, index: item.op === 'sum' ? columnIndex(columns, item.column) : null };
        });
        const nextColumns = [...operation.by, ...aggregations.map(item => item.as)];
        if (new Set(nextColumns).size !== nextColumns.length) throw new Error('汇总结果列名不能重复');
        const groups = new Map();
        for (const row of rows) {
          const keyValues = indices.map(index => row[index]), key = JSON.stringify(keyValues);
          if (!groups.has(key)) groups.set(key, [...keyValues, ...aggregations.map(() => 0)]);
          const grouped = groups.get(key);
          aggregations.forEach((item, index) => {
            grouped[indices.length + index] += item.op === 'count' ? 1 : numeric(row[item.index]);
            if (!Number.isFinite(grouped[indices.length + index])) throw new Error('汇总数值超过可处理范围');
          });
        }
        columns = nextColumns;
        rows = [...groups.values()];
        break;
      }
      default: throw new Error('支持选列、筛选、排序、去重、分组计数和求和，不支持任意代码');
    }
  }
  return { columns, rows };
}

export async function registerTableTools({ registry, task, signal, assertActive }) {
  const userId = String(task.userId), projectId = task.projectId ? String(task.projectId) : null, conversationId = String(task.conversationId);
  async function load(fileId, sheet) {
    await assertActive();
    if (typeof fileId !== 'string' || typeof sheet !== 'string') throw new Error('文件和工作表编号不正确');
    await requireReadableProjectDocument({ userId, projectId, conversationId, fileId });
    const document = await WorkspaceDocument.findOne({ userId, fileId }).select('tables').lean();
    if (!document?.tables?.length) throw new Error('该资料没有可整理的 Excel 或 CSV 表格');
    if (!sheet) return { sheets: document.tables.map(table => ({ name: table.name, headerRow: table.rows[0].rowNumber, rowCount: table.rows.length - 1 })) };
    const table = document.tables.find(item => item.name === sheet);
    if (!table) throw new Error('工作表不存在，请先查看工作表名称');
    const columns = table.rows[0].values.map(value => value === null ? '' : String(value));
    if (columns.some(value => !value.trim()) || new Set(columns).size !== columns.length) throw new Error('表头包含空白或重复列名，请整理源文件后上传');
    const rows = table.rows.slice(1).map(row => row.values);
    if (rows.some(row => row.length !== columns.length)) throw new Error('表格行列数量不一致');
    return { columns, rows, source: { fileId, sheet, headerRow: table.rows[0].rowNumber } };
  }
  registry.add(defineTaskTool('inspect_table', '查看项目中已上传 Excel/CSV 的真实表格。sheet传空字符串列出工作表；指定工作表返回列名、数据行数和前20行。第一个非空行作为表头；CSV工作表名称是CSV。', {
    fileId: textParameter('文件编号'), sheet: textParameter('工作表名称；空字符串用于列出工作表'),
  }, async ({ fileId, sheet }) => {
    const table = await load(fileId, sheet);
    if (!sheet) return table;
    return { source: table.source, columns: table.columns, rowCount: table.rows.length, previewRows: table.rows.slice(0, 20) };
  }));
  registry.add(defineTaskTool('transform_table', '对项目Excel/CSV原始数据按顺序整理并导出。operationsJson是操作数组：select{columns}；filter{column,operator:eq/ne/contains/gt/gte/lt/lte/empty/not_empty,value}，eq/ne严格匹配类型；sort{column,direction:asc/desc,numeric:布尔值}；deduplicate{columns}保留首行；group{by:列名数组,aggregations:[{op:count,as:结果列名},{op:sum,column:原列名,as:结果列名}]}。每项必须有type。只使用文件真实数据，不接受脚本或自行编造的行。', {
    fileId: textParameter('文件编号'), sheet: textParameter('工作表名称，CSV为CSV'), operationsJson: textParameter('声明式操作的JSON数组，最多20项'), name: textParameter('结果文件名'), format: textParameter('xlsx或csv'),
  }, async ({ fileId, sheet, operationsJson, name, format }) => {
    if (!sheet || !['xlsx', 'csv'].includes(format)) throw new Error('请指定工作表和 xlsx/csv 导出格式');
    const table = await load(fileId, sheet);
    const operations = JSON.parse(operationsJson);
    const result = transform(table, operations, signal);
    await assertActive();
    const file = await createTaskArtifact({ userId, projectId, conversationId, taskId: String(task._id), name, format, ...result });
    await WorkbenchTask.updateOne({ _id: task._id, userId }, { $push: { artifacts: file } });
    await appendTaskEvent(task, 'artifact', '已整理表格并生成 ' + file.name, { ...file, source: table.source, operations, inputRows: table.rows.length, outputRows: result.rows.length });
    return { file, source: table.source, columns: result.columns, rowCount: result.rows.length, previewRows: result.rows.slice(0, 20) };
  }));
}
