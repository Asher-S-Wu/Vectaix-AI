import UserConnection from '@/models/UserConnection';
import {findOwnedStoredFile,readStoredFileBuffer} from '../storage/service';
import UserSettings from '@/models/UserSettings';
import {ownedConnection} from './connections';
import {connectMcp} from './mcp';
import {needsConfirmation} from './policy.mjs';
import {listRemoteFiles,readRemoteFile,importRemoteFile,writeRemoteStoredFile,uploadRemoteFile} from './remotes';
import {browserAction,closeBrowser,prepareBrowserAction} from '../browser/service';
import {withApproval,invalidateTaskApprovals} from '../workbench/approvals';
const object=properties=>({type:'object',properties,additionalProperties:false});
export async function registerIntegrationTools({registry,task,signal,assertActive}){
 const settings=await UserSettings.findOne({userId:task.userId}).lean();const permissions=settings?.permissions || {};
 const connections=permissions.externalTools?await UserConnection.find({userId:task.userId,enabled:true}).lean():[];
 for(const connection of connections){
  const connectionId=String(connection._id);const prefix=`ext_${connectionId}`;
  if(connection.kind==='mcp'){
   for(const tool of connection.tools.filter(x=>x.enabled)){
    const name=`${prefix}_${connection.tools.indexOf(tool)}`;
    registry.add({permission:'externalTools',definition:{name,description:`${connection.name}: ${tool.description || tool.name}`,parameters:tool.inputSchema || object({})},sensitiveArguments:true,sensitiveResult:true,execute:async(args,{callId})=>{
     const execute=async approvedArgs=>{
      await assertActive();const current=await ownedConnection(task.userId,connectionId,{secrets:true});
      if(!current.enabled||!current.tools.some(x=>x.name===tool.name&&x.enabled))throw new Error('连接或工具已停用');
      const client=await connectMcp(current,{signal});try{return await client.callTool({name:tool.name,arguments:approvedArgs},undefined,{signal,timeout:120000});}catch{throw Object.assign(new Error('外部工具未返回确定结果，未自动重试，请核实外部系统'),{stopTask:true,code:'EXTERNAL_RESULT_UNKNOWN'});}finally{await client.close();}
     };
     return needsConfirmation(tool.annotations)?withApproval({task,tool:`${connection.name} / ${tool.name}`,args,callId,signal,assertActive},execute):execute(args);
    }});
   }
   if(connection.resources.length)registry.add({permission:'externalTools',definition:{name:`${prefix}_resource`,description:`读取 ${connection.name} 的已公布资料。可用 URI: ${connection.resources.map(x=>x.uri).join(', ').slice(0,5000)}`,parameters:{...object({uri:{type:'string',enum:connection.resources.map(x=>x.uri)}}),required:['uri']}},sensitiveResult:true,execute:async args=>{await assertActive();const client=await connectMcp(await ownedConnection(task.userId,connectionId,{secrets:true}),{signal});try{return await client.readResource({uri:args.uri},{signal});}finally{await client.close();}}});
   if(connection.prompts.length)registry.add({permission:'externalTools',definition:{name:`${prefix}_prompt`,description:`读取 ${connection.name} 的提示模板`,parameters:{...object({name:{type:'string',enum:connection.prompts.map(x=>x.name)},arguments:{type:'object',additionalProperties:{type:'string'}}}),required:['name']}},sensitiveArguments:true,sensitiveResult:true,execute:async args=>{await assertActive();const client=await connectMcp(await ownedConnection(task.userId,connectionId,{secrets:true}),{signal});try{return await client.getPrompt(args,{signal});}finally{await client.close();}}});
  }else{
   registry.add({permission:'externalTools',definition:{name:`${prefix}_files`,description:`访问远端文件夹「${connection.name}」。list 列出目录，read 读取文本，import 导入文件，write 将工作文件写回远端（需用户确认）。`,parameters:{...object({action:{type:'string',enum:['list','read','import','write']},path:{type:'string',maxLength:1024},fileId:{type:'string'}}),required:['action','path']}},sensitiveResult:true,execute:async(args,{callId})=>{
    const execute=async value=>{await assertActive();const common={userId:task.userId,connectionId,path:value.path,signal};
     if(value.action==='list')return {files:await listRemoteFiles(common)};
     if(value.action==='read')return {text:(await readRemoteFile(common)).toString('utf8').slice(0,80000)};
     if(value.action==='import')return {file:await importRemoteFile({...common,task})};
     return writeRemoteStoredFile({...common,fileId:value.fileId,destinationPath:value.path});};
    if(args.action!=='write')return execute(args);
    const file=await findOwnedStoredFile({userId:task.userId,fileId:args.fileId});if(!file||file.size>20971520)throw new Error('文件不存在或超过 20 MB');
    const reviewFile={name:file.originalName,mimeType:file.mimeType,input:await readStoredFileBuffer(file)};
    return withApproval({task,tool:`写回 ${connection.name}`,args,callId,signal,assertActive,reviewFile},async(value,{snapshotPath})=>{await assertActive();return uploadRemoteFile({userId:task.userId,connectionId,localPath:snapshotPath,destinationPath:value.path,signal});});
   }});
  }
 }
 if(permissions.browser)registry.add({permission:'browser',definition:{name:'browser',description:'使用独立浏览器浏览公开网站。先 observe 获取元素编号，再 click/fill。涉及点击、填表、上传、下载及打开网页均需用户确认；登录密码与验证码请用户在设置中的浏览器面板手动完成。最多三个标签页。禁止执行任意脚本。',parameters:{...object({action:{type:'string',enum:['navigate','new_tab','observe','screenshot','click','fill','scroll','upload','download','close_tab']},url:{type:'string'},tabId:{type:'string'},element:{type:'integer',minimum:0,maximum:159},text:{type:'string',maxLength:10000},amount:{type:'number',minimum:-3000,maximum:3000},fileId:{type:'string'}}),required:['action']}},sensitiveArguments:true,sensitiveResult:true,execute:async(args,{callId})=>{
  const execute=async action=>{await assertActive();return browserAction({userId:task.userId,taskId:task._id,task,action,signal});};
  if(['observe','screenshot','scroll','close_tab'].includes(args.action))return execute(args);
  const frozen=await prepareBrowserAction({userId:task.userId,taskId:task._id,action:args,signal});let reviewFile;
  if(args.action==='upload'){const file=await findOwnedStoredFile({userId:task.userId,fileId:args.fileId});if(!file||file.size>20971520)throw new Error('文件不存在或超过 20 MB');reviewFile={name:file.originalName,mimeType:file.mimeType,input:await readStoredFileBuffer(file)};}
  try{return await withApproval({task,tool:'浏览器操作',args:{...args,reviewPage:frozen.review},callId,signal,assertActive,reviewFile},async(action,{snapshotPath})=>{await assertActive();return browserAction({userId:task.userId,taskId:task._id,task,action,signal,frozen,uploadPath:snapshotPath});});}finally{await frozen.target?.dispose();}
 }});
}
export async function cleanupIntegrationTask(task){await invalidateTaskApprovals(task._id);await closeBrowser(task.userId,{taskId:task._id});}
