import { spawn } from 'node:child_process';
import {registerIntegrationFile} from './artifacts';
import { rcloneExecutable } from './rclone.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ownedConnection, credentials } from './connections';
import { publicAddress } from './network.mjs';
import { assertPublicUrl } from '../security/publicUrl.mjs';
import { remotePath } from './policy.mjs';
import { createStoredFile,serializeStoredFile,findOwnedStoredFile,getStoredFileAbsolutePath,deleteStoredFileDocument } from '../storage/service';
function run(args,{signal,input,maxBytes=20971520,env={},timeoutMs=120000}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(rcloneExecutable(),args,{shell:false,env:{PATH:process.env.PATH,...env},stdio:['pipe','pipe','pipe'],signal});
  let bytes=0;const chunks=[];let settled=false;
  const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(Object.assign(new Error('远端操作超时，未自动重试'),{stopTask:true,code:'EXTERNAL_RESULT_UNKNOWN'}));},timeoutMs);
  child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes){child.kill('SIGKILL');reject(new Error('文件或列表超过 20 MB 限制'));}else chunks.push(chunk);});
  child.stderr.resume();child.on('error',()=>{clearTimeout(timeout);settled=true;reject(new Error('远端操作无法启动，请检查服务器 rclone 配置'));});
  child.on('close',code=>{clearTimeout(timeout);if(!settled){if(code===0)resolve(Buffer.concat(chunks));else reject(Object.assign(new Error('远端操作失败，未自动重试，请检查连接和权限'),{stopTask:true,code:'EXTERNAL_RESULT_UNKNOWN'}));}});
  child.stdin.end(input);
 });
}
function configValue(value){const text=String(value ?? '');if(/[\r\n\x00]/.test(text))throw new Error('连接配置包含非法字符');return text;}
async function withRemote(userId,connectionId,signal,fn,maxBytes=20971520){
 const c=await ownedConnection(userId,connectionId,{secrets:true});
 if(!c.enabled || c.kind==='mcp')throw new Error('远端连接未启用');
 const url=await assertPublicUrl(c.config.url,{protocols:[{webdav:'https:',s3:'https:',sftp:'sftp:',smb:'smb:',ftp:'ftp:'}[c.kind]]});
 const address=await publicAddress(url.hostname);const secret=credentials(c);const dir=await mkdtemp(path.join(os.tmpdir(),'vectaix-remote-'));
 try{
  const entries={type:c.kind};
  if(['webdav','s3'].includes(c.kind)){
   // HTTP connections resolve public addresses inside the validating proxy.
   if(c.kind==='webdav'){entries.url=url.toString();entries.vendor='other';entries.user=secret.username || '';}
   else{entries.provider='Other';entries.endpoint=url.toString();entries.region=c.config.region;entries.access_key_id=secret.accessKeyId;entries.secret_access_key=secret.secretAccessKey;entries.force_path_style='true';}
  }else{
   entries.host=address.address;entries.port=url.port || {sftp:'22',smb:'445',ftp:'21'}[c.kind];entries.user=secret.username;
   if(c.kind==='sftp'){entries.shell_type='none';
    if(!secret.knownHosts)throw new Error('SFTP 需要填写服务器 known_hosts 公钥');
    await writeFile(path.join(dir,'known_hosts'),configValue(secret.knownHosts).replace(url.hostname,address.address)+'\n',{mode:0o600});entries.known_hosts_file=path.join(dir,'known_hosts');
   }
   if(c.kind==='ftp'){entries.explicit_tls='true';entries.disable_tls13='false';entries.host=url.hostname;entries.disable_epsv='false';}
   if(c.kind==='smb')entries.domain=secret.domain || '';
  }
  if(secret.password)entries.pass=(await run(['obscure','-'],{signal,input:configValue(secret.password),maxBytes:8192})).toString().trim();
  const config=path.join(dir,'rclone.conf');await writeFile(config,'[remote]\n'+Object.entries(entries).map(([key,value])=>`${key} = ${configValue(value)}`).join('\n')+'\n',{mode:0o600});
  const root=remotePath(c.config.root || '');const target=p=>`remote:${[root,remotePath(p)].filter(Boolean).join('/')}`;
  const common=['--config',config,'--retries','1','--low-level-retries','1','--contimeout','20s','--timeout','60s','--max-transfer',String(maxBytes),'--disable-http2'];
  let proxy;const env={};
  if(['webdav','s3','ftp'].includes(c.kind)){const {startPublicProxy}=await import('../browser/proxy');proxy=await startPublicProxy(c.kind==='ftp'?{connectPorts:null,allowedHostname:url.hostname}:{allowedHostname:url.hostname});if(c.kind==='ftp')common.push('--ftp-http-proxy',proxy.url);env.http_proxy=proxy.url;env.https_proxy=proxy.url;env.HTTP_PROXY=proxy.url;env.HTTPS_PROXY=proxy.url;}
  try{return await fn({target,common,dir,env,connection:c});}finally{await proxy?.close();}
 }finally{await rm(dir,{recursive:true,force:true});}
}
export async function listRemoteFiles({userId,connectionId,path:remote='',signal}){
 return withRemote(userId,connectionId,signal,async({target,common,env})=>JSON.parse((await run(['lsjson',target(remote),'--max-depth','1',...common],{signal,env})).toString()).map(x=>({name:x.Name,path:[remote,x.Name].filter(Boolean).join('/'),size:x.Size,isDirectory:x.IsDir,modifiedAt:x.ModTime})));
}
export async function readRemoteFile({userId,connectionId,path:remote,signal}){
 return withRemote(userId,connectionId,signal,async({target,common,env})=>run(['cat',target(remote),...common],{signal,env}));
}
export async function uploadRemoteFile({userId,connectionId,localPath,destinationPath,signal,maxBytes=20971520}){
 if(!remotePath(destinationPath))throw new Error('请输入目标文件路径');
 return withRemote(userId,connectionId,signal,async({target,common,env})=>{await run(['copyto',localPath,target(destinationPath),...common],{signal,env,timeoutMs:maxBytes>20971520?900000:120000});return {path:destinationPath};},maxBytes);
}
export async function importRemoteFile({userId,connectionId,path:remote,task,signal}){
 const buffer=await readRemoteFile({userId,connectionId,path:remote,signal});
 const file=await createStoredFile({userId,input:buffer,originalName:path.basename(remote),mimeType:'application/octet-stream',extension:path.extname(remote).slice(1),category:'document',kind:task?'task-artifact':'library',ownerType:task?'task':'library',ownerId:task?String(task._id):null});
 try{return await registerIntegrationFile({userId,task,file,input:buffer});}catch(error){await deleteStoredFileDocument(file);throw error;}
}
export async function writeRemoteStoredFile({userId,connectionId,fileId,destinationPath,signal}){
 const file=await findOwnedStoredFile({userId,fileId});if(!file)throw new Error('文件不存在');
 return uploadRemoteFile({userId,connectionId,localPath:getStoredFileAbsolutePath(file),destinationPath,signal});
}
