import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToolSchema } from '../../lib/server/workbench/toolSchema.mjs';
test('MCP完整参数结构保留可选字段、嵌套数组、枚举和联合类型约束', () => {
  const check = compileToolSchema({type:'object',required:['rows'],additionalProperties:false,properties:{rows:{type:'array',minItems:1,items:{type:'object',required:['name','value'],additionalProperties:false,properties:{name:{type:'string',minLength:1},value:{anyOf:[{type:'number',minimum:0},{type:'null'}]}}}},mode:{enum:['read','write']}}});
  assert.deepEqual(check({rows:[{name:'x',value:null},{name:'y',value:1.5}]}).rows[1],{name:'y',value:1.5});
  for(const value of [{rows:[]},{rows:[{name:'x',value:-1}]},{rows:[{name:'x'}]},{rows:[{name:'x',value:1}],mode:'delete'},{rows:[{name:'x',value:1}],extra:true}]) assert.throws(()=>check(value),/工具参数无效/);
});
