import WorkbenchTask from '@/models/WorkbenchTask';
import {appendTaskEvent} from '../workbench/events';
import {serializeStoredFile} from '../storage/service';
export async function registerIntegrationFile({userId,task,file,input}){
 if(['pdf','docx','xlsx','csv','txt','md'].includes(file.extension)){
  const {indexStoredDocument}=await import('../workbench/documents');
  await indexStoredDocument({userId,file,input,projectId:task?.projectId || null,conversationId:task?.conversationId || null});
 }
 const serialized=serializeStoredFile(file);
 if(task){
  const result=await WorkbenchTask.updateOne({_id:task._id,userId,'artifacts.fileId':{$ne:file.fileId}},{$push:{artifacts:serialized}});
  if(result.modifiedCount)await appendTaskEvent(task,'artifact',`已保存 ${serialized.name}`,serialized);
 }
 return serialized;
}
