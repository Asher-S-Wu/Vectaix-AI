export function remotePath(value = '') {
  if(typeof value !== 'string' || value.length > 1024 || /[\\\x00-\x1f:]/.test(value) || value.startsWith('/') || value.split('/').some(x => x === '..' || x === '.')) throw new Error('远端路径无效');
  return value;
}
export function needsConfirmation(annotations) { return annotations?.readOnlyHint !== true || annotations?.destructiveHint === true; }
export function parseMcpImport(input) {
  if(!input?.mcpServers || typeof input.mcpServers !== 'object') throw new Error('请粘贴包含 mcpServers 的配置');
  return Object.entries(input.mcpServers).map(([name,server])=>{
    if(!server || server.command || server.args || server.env || ['sse','stdio'].includes(server.transport) || ['sse','stdio'].includes(server.type) || typeof server.url !== 'string') throw new Error('只支持 Streamable HTTP 连接，不支持本地命令或旧版 SSE');
    const headers=server.headers || {};
    if(Object.keys(headers).some(k=>!['authorization','x-api-key'].includes(k.toLowerCase()))) throw new Error('配置只接受 Authorization 或 X-API-Key 认证');
    const auth=Object.entries(headers).find(([k])=>k.toLowerCase()==='authorization')?.[1];
    const key=Object.entries(headers).find(([k])=>k.toLowerCase()==='x-api-key')?.[1];
    if(auth && !/^Bearer \S+$/.test(auth)) throw new Error('Authorization 必须为 Bearer 密钥');
    return {name,kind:'mcp',config:{url:server.url,authType:auth||key?'apiKey':'none',apiKeyHeader:key?'X-API-Key':'Authorization'},credentials:{apiKey:key || auth?.slice(7) || ''}};
  });
}
