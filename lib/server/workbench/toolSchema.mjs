import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const legacy = addFormats(new Ajv({ strict: false, allErrors: false }));
const current = addFormats(new Ajv2020({ strict: false, allErrors: false }));
export function compileToolSchema(schema) {
  if (!schema || schema.type !== 'object') throw new Error('工具必须提供对象参数结构');
  const validator = (schema.$schema?.includes('2020-12') ? current : legacy).compile(schema);
  return value => {
    if (!validator(value)) throw new Error(`工具参数无效：${validator.errors[0].instancePath || '/'} ${validator.errors[0].keyword}`);
    return value;
  };
}
