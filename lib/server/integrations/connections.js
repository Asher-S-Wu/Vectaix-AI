import mongoose from 'mongoose';
import UserConnection from '@/models/UserConnection';
import UserSettings from '@/models/UserSettings';
import { encryptSecret,decryptSecret } from '../security/secrets.mjs';
import { assertPublicUrl } from '../security/publicUrl.mjs';
import { requireObjectId, workbenchError } from '../workbench/apiHelpers';
import { remotePath } from './policy.mjs';
export const secretContext=c=>`connection:${c.userId}:${c._id}`;
export function credentials(c){return c.secret?decryptSecret(c.secret,secretContext(c)):{};}
export async function saveCredentials(c,value){c.secret=encryptSecret(value,secretContext(c));await UserConnection.updateOne({_id:c._id,userId:c.userId},{$set:{secret:c.secret}});}
export function serializeConnection(c){return {id:String(c._id),name:c.name,kind:c.kind,enabled:c.enabled,config:c.config,tools:c.tools,resources:c.resources,prompts:c.prompts,testedAt:c.testedAt};}
export async function ownedConnection(userId,id,{secrets=false}={}) {
 requireObjectId(id);let query=UserConnection.findOne({_id:id,userId});if(secrets)query=query.select('+secret +oauthPending');
 const c=await query.lean();if(!c)throw workbenchError('连接不存在',404);return c;
}
export async function createConnection(userId,body){
 if(typeof body.name!=='string'||!body.name.trim()||body.name.length>80)throw workbenchError('请输入 80 字以内的名称');
 if(!['mcp','webdav','s3','sftp','smb','ftp'].includes(body.kind))throw workbenchError('连接类型无效');
 const input=body.config || {};let config;
 if(body.kind==='mcp'){
  const url=await assertPublicUrl(input.url,{protocols:['https:']});
  if(!['none','apiKey','oauth'].includes(input.authType))throw workbenchError('认证方式无效');
  config={url:url.toString(),authType:input.authType,apiKeyHeader:input.apiKeyHeader==='X-API-Key'?'X-API-Key':'Authorization'};
 }else{
  const protocol={webdav:'https:',s3:'https:',sftp:'sftp:',smb:'smb:',ftp:'ftp:'}[body.kind];
  const url=await assertPublicUrl(input.url,{protocols:[protocol]});
  config={url:url.toString(),root:remotePath(input.root || ''),region:String(input.region || '').slice(0,80)};
 }
 const secret=body.credentials || {};
 if(typeof secret!=='object'||Array.isArray(secret)||JSON.stringify(secret).length>20000)throw workbenchError('凭据无效');
 const id=new mongoose.Types.ObjectId();const c={_id:id,userId,name:body.name.trim(),kind:body.kind,config,enabled:true};
 return UserConnection.create({...c,secret:encryptSecret(secret,secretContext(c))});
}
export async function updateConnection(userId,id,body){
 const c=await ownedConnection(userId,id);const update={};
 if('name'in body){if(typeof body.name!=='string'||!body.name.trim()||body.name.length>80)throw workbenchError('连接名称无效');update.name=body.name.trim();}
 if('enabled'in body){if(typeof body.enabled!=='boolean')throw workbenchError('开关值无效');update.enabled=body.enabled;}
 if('tools'in body){if(!Array.isArray(body.tools)||body.tools.some(x=>typeof x.name!=='string'||typeof x.enabled!=='boolean'||!c.tools.some(t=>t.name===x.name)))throw workbenchError('工具选择无效');update.tools=c.tools.map(tool=>({...tool,enabled:body.tools.find(x=>x.name===tool.name)?.enabled ?? tool.enabled}));}
 if('credentials'in body){if(!body.credentials || typeof body.credentials!=='object'||Array.isArray(body.credentials)||JSON.stringify(body.credentials).length>20000)throw workbenchError('凭据无效');update.secret=encryptSecret(body.credentials,secretContext(c));}
 return UserConnection.findOneAndUpdate({_id:id,userId},{$set:update},{new:true}).lean();
}

export async function assertExternalToolsEnabled(userId){const settings=await UserSettings.findOne({userId}).lean();if(settings?.permissions?.externalTools!==true)throw workbenchError('请先开启外部工具权限',403);}
