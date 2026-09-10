import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import mongoose from 'mongoose';
import {MongoMemoryServer} from 'mongodb-memory-server';
import Conversation from '../models/Conversation';
import {createStoredFile} from '../lib/server/storage/service';
import {registerIntegrationFile} from '../lib/server/integrations/artifacts';
import {readProjectDocument} from '../lib/server/workbench/documents';
import TaskApproval from '../models/TaskApproval';
import WorkbenchTask from '../models/WorkbenchTask';
import UserConnection from '../models/UserConnection';
import {decideApproval,withApproval,recoverApprovals,readApprovalSnapshot} from '../lib/server/workbench/approvals';
import {credentials,ownedConnection,createConnection,serializeConnection} from '../lib/server/integrations/connections';
let mongo;
before(async()=>{process.env.STORAGE_ROOT=await mkdtemp(path.join(os.tmpdir(),'approval-test-'));process.env.APP_SECRETS_KEY=Buffer.alloc(32,7).toString('base64');mongo=await MongoMemoryServer.create();await mongoose.connect(mongo.getUri());await TaskApproval.init();});
after(async()=>{await mongoose.disconnect();await mongo.stop();await rm(process.env.STORAGE_ROOT,{recursive:true,force:true});});
const id=()=>new mongoose.Types.ObjectId();
async function makeTask(){return WorkbenchTask.create({userId:id(),conversationId:id(),requestId:String(id()),fingerprint:'fp',userMessageId:'u',modelMessageId:'m',model:'test',status:'running'});}
test('approval cannot be claimed by another user and may be decided only once',async()=>{
 const task=await makeTask();const item=await TaskApproval.create({userId:task.userId,taskId:task._id,tool:'write',callId:'a',arguments:{path:'approved.txt'},expiresAt:new Date(Date.now()+60000)});
 await assert.rejects(()=>decideApproval(String(id()),String(task._id),String(item._id),'approved'));
 await decideApproval(String(task.userId),String(task._id),String(item._id),'approved');
 await assert.rejects(()=>decideApproval(String(task.userId),String(task._id),String(item._id),'approved'));
});
test('execution uses the persisted immutable arguments and executes once',async()=>{
 const task=await makeTask();let executions=0;let captured;
 const args={path:'allowed.txt'};const run=withApproval({task,tool:'write',args,callId:'b',assertActive:async()=>{}},async value=>{executions++;captured=value;return 'done';});
 let item;while(!item){await new Promise(r=>setTimeout(r,20));item=await TaskApproval.findOne({taskId:task._id}).lean();}
 args.path='mutated.txt';
 await TaskApproval.updateOne({_id:item._id},{$set:{arguments:{path:'injected.txt'}}});
 await decideApproval(String(task.userId),String(task._id),String(item._id),'approved');
 assert.equal(await run,'done');assert.equal(executions,1);assert.deepEqual(captured,{path:'allowed.txt'});
 assert.equal((await TaskApproval.findById(item._id)).status,'completed');
});
test('expired approvals and approvals surviving a restart cannot execute',async()=>{
 const userId=id(),taskId=id();const expired=await TaskApproval.create({userId,taskId,tool:'delete',callId:'c',arguments:{},expiresAt:new Date(Date.now()-1)});
 await assert.rejects(()=>decideApproval(String(userId),String(taskId),String(expired._id),'approved'));
 const pending=await TaskApproval.create({userId,taskId,tool:'delete',callId:'d',arguments:{},expiresAt:new Date(Date.now()+60000)});
 await recoverApprovals();assert.equal((await TaskApproval.findById(pending._id)).status,'unknown');
});
test('per-user connection credentials remain encrypted and cannot be read across users',async()=>{
 const userId=id();const c=await createConnection(userId,{name:'test',kind:'mcp',config:{url:'https://1.1.1.1/mcp',authType:'apiKey'},credentials:{apiKey:'private-key'}});
 const defaultRead=await UserConnection.findById(c._id).lean();assert.equal(defaultRead.secret,undefined);assert.equal(JSON.stringify(serializeConnection(defaultRead)).includes('private-key'),false);
 const owned=await ownedConnection(String(userId),String(c._id),{secrets:true});assert.equal(credentials(owned).apiKey,'private-key');
 await assert.rejects(()=>ownedConnection(String(id()),String(c._id),{secrets:true}));
 assert.throws(()=>credentials({...owned,userId:id()}));
});

test('approval files preserve the reviewed bytes and cannot be read by another account',async()=>{
 const task=await makeTask();const input=Buffer.from('approved content');let submitted;
 const running=withApproval({task,tool:'upload',args:{fileId:'editable-source'},callId:'snapshot',reviewFile:{input,name:'review.txt',mimeType:'text/plain'},assertActive:async()=>{}},async(_args,{snapshotPath})=>{submitted=await readFile(snapshotPath);return 'ok';});
 let item;while(!item){await new Promise(resolve=>setTimeout(resolve,20));item=await TaskApproval.findOne({taskId:task._id}).lean();}
 input.fill(0);const review=await readApprovalSnapshot(String(task.userId),String(task._id),String(item._id));assert.equal(review.input.toString(),'approved content');assert.equal(review.name,'review.txt');
 await assert.rejects(()=>readApprovalSnapshot(String(id()),String(task._id),String(item._id)));
 await decideApproval(String(task.userId),String(task._id),String(item._id),'approved');await running;assert.equal(submitted.toString(),'approved content');
 await assert.rejects(()=>readApprovalSnapshot(String(task.userId),String(task._id),String(item._id)));
});

test('imported task files are registered and readable by the current conversation',async()=>{
 const task=await makeTask();await Conversation.create({_id:task.conversationId,userId:task.userId,title:'import test'});
 const input=Buffer.from('Imported external document content');const file=await createStoredFile({userId:task.userId,input,originalName:'source.txt',mimeType:'text/plain',extension:'txt',category:'document',kind:'task-artifact',ownerType:'task',ownerId:String(task._id)});
 await registerIntegrationFile({userId:task.userId,task,file,input});
 const current=await WorkbenchTask.findById(task._id).lean();assert.equal(current.artifacts[0].fileId,file.fileId);
 const document=await readProjectDocument({userId:String(task.userId),conversationId:String(task.conversationId),fileId:file.fileId});assert.match(JSON.stringify(document.chunks),/Imported external/);
});
