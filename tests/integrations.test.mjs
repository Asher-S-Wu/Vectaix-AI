import test from 'node:test';
import assert from 'node:assert/strict';
import { remotePath, parseMcpImport, needsConfirmation } from '../lib/server/integrations/policy.mjs';
test('remote files cannot escape the configured root or inject a remote', () => {
  for (const input of ['../private','x/../../private','s3:bucket','/absolute','x\\y','x\n--flag']) assert.throws(()=>remotePath(input));
  assert.equal(remotePath('reports/2026.csv'),'reports/2026.csv');
});
test('MCP imports accept only remote Streamable HTTP and keep each server isolated', () => {
  const values=parseMcpImport({mcpServers:{reports:{url:'https://example.com/mcp',headers:{Authorization:'Bearer abc'}}}});
  assert.equal(values.length,1);assert.equal(values[0].name,'reports');assert.equal(values[0].credentials.apiKey,'abc');
  assert.throws(()=>parseMcpImport({mcpServers:{local:{command:'node',args:['server.js']}}}));
  assert.throws(()=>parseMcpImport({mcpServers:{old:{url:'https://example.com',transport:'sse'}}}));
});
test('unknown MCP tools and browser actions require confirmation', () => {
  assert.equal(needsConfirmation({}),true);
  assert.equal(needsConfirmation({readOnlyHint:true}),false);
  assert.equal(needsConfirmation({readOnlyHint:true,destructiveHint:true}),true);
});
