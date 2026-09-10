import mongoose from 'mongoose';
import path from 'node:path';
import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {getStorageRoot} from '../storage/config';
import TaskApproval from '@/models/TaskApproval';
import WorkbenchTask from '@/models/WorkbenchTask';
import { appendTaskEvent } from './events';
import { workbenchError, requireObjectId } from './apiHelpers';
import { setTimeout as delay } from 'node:timers/promises';
export async function listApprovals(userId,taskId) {
 requireObjectId(taskId);
 if(!await WorkbenchTask.exists({_id:taskId,userId})) throw workbenchError('任务不存在',404);
 await TaskApproval.updateMany({userId,taskId,status:{$in:['pending','approved']},expiresAt:{$lte:new Date()}},{$set:{status:'expired'}});
 return TaskApproval.find({userId,taskId}).sort({createdAt:1}).lean();
}
export async function decideApproval(userId,taskId,id,decision) {
 requireObjectId(taskId);requireObjectId(id);
 if(!['approved','rejected'].includes(decision)) throw workbenchError('请选择允许或拒绝');
 const item=await TaskApproval.findOneAndUpdate({_id:id,userId,taskId,status:'pending',expiresAt:{$gt:new Date()}},{$set:{status:decision,decidedAt:new Date()}},{new:true}).lean();
 if(!item) throw workbenchError('确认已失效或已处理',409);
 return item;
}
export async function invalidateTaskApprovals(taskId) {
 await TaskApproval.updateMany({taskId,status:{$in:['pending','approved','executing']}},{$set:{status:'unknown'}});
}
export async function recoverApprovals() {
 await rm(path.join(getStorageRoot(),'approval-snapshots'),{recursive:true,force:true});
 await TaskApproval.updateMany({status:{$in:['pending','approved','executing']}},{$set:{status:'unknown'}});
}
function snapshotPath(userId,id){return path.join(getStorageRoot(),'approval-snapshots',requireObjectId(String(userId)),requireObjectId(String(id)));}
export async function readApprovalSnapshot(userId,taskId,id){requireObjectId(taskId);requireObjectId(id);const item=await TaskApproval.findOne({_id:id,userId,taskId,status:{$in:['pending','approved','executing']},expiresAt:{$gt:new Date()}}).select('+snapshot').lean();if(!item?.snapshot)throw workbenchError('待确认文件已失效',404);return {...item.snapshot,input:await readFile(snapshotPath(userId,id))};}
export async function withApproval({task,tool,args,callId,signal,assertActive,reviewFile},execute) {
 await assertActive();
 const id=new mongoose.Types.ObjectId();let filePath;let snapshot;const approvalArgs=structuredClone(args);
 if(reviewFile){if(!Buffer.isBuffer(reviewFile.input)||reviewFile.input.length>20971520)throw workbenchError('待确认文件不得超过 20 MB');filePath=snapshotPath(task.userId,id);await mkdir(path.dirname(filePath),{recursive:true,mode:0o700});await writeFile(filePath,reviewFile.input,{flag:'wx',mode:0o400});snapshot={name:reviewFile.name,size:reviewFile.input.length,mimeType:reviewFile.mimeType};approvalArgs.reviewFile={...snapshot,url:`/api/tasks/${task._id}/approvals/${id}/file`};}
 let approval;try{approval=await TaskApproval.create({_id:id,userId:task.userId,taskId:task._id,callId,tool,arguments:approvalArgs,snapshot,expiresAt:new Date(Date.now()+300000)});}catch(error){if(filePath)await rm(filePath,{force:true});throw error;}
 try {
 await WorkbenchTask.updateOne({_id:task._id,userId:task.userId,status:'running'},{$set:{status:'waiting_approval'}});
 await appendTaskEvent(task,'approval_required','请确认外部操作',{approvalId:String(approval._id),tool,callId});
  for(;;) {
   if(signal?.aborted) throw new Error('任务已停止');
   const active=await WorkbenchTask.exists({_id:task._id,userId:task.userId,stopRequested:false,status:{$in:['running','waiting_approval']}});
   if(!active) throw new Error('任务已停止');
   const current=await TaskApproval.findById(approval._id).lean();
   if(!current || current.expiresAt<=new Date()) { await TaskApproval.updateOne({_id:approval._id,status:{$in:['pending','approved']}},{$set:{status:'expired'}});throw Object.assign(new Error('确认已超时，操作未执行'),{stopTask:true,code:'APPROVAL_EXPIRED'}); }
   if(current.status==='approved') break;
   if(current.status!=='pending') throw Object.assign(new Error('操作未获确认，已取消'),{stopTask:true,code:'APPROVAL_REJECTED'});
   await delay(400,undefined,{signal});
  }
  const claimed=await TaskApproval.findOneAndUpdate({_id:approval._id,status:'approved',expiresAt:{$gt:new Date()}},{$set:{status:'executing',executionStartedAt:new Date()}},{new:true}).lean();
  if(!claimed) throw Object.assign(new Error('确认已使用或失效'),{stopTask:true,code:'APPROVAL_EXPIRED'});
  await WorkbenchTask.updateOne({_id:task._id,status:'waiting_approval',stopRequested:false},{$set:{status:'running'}});
  await assertActive();
  const result=await execute(structuredClone(claimed.arguments),{snapshotPath:filePath});
  await TaskApproval.updateOne({_id:approval._id,status:'executing'},{$set:{status:'completed'}});
  return result;
 } catch(error) {
  error.stopTask=true;
  await TaskApproval.updateOne({_id:approval._id,status:{$in:['pending','approved','executing']}},{$set:{status:'unknown'}});
  throw error;
 } finally { if(filePath)await rm(filePath,{force:true});await WorkbenchTask.updateOne({_id:task._id,status:'waiting_approval',stopRequested:false},{$set:{status:'running'}}); }
}
