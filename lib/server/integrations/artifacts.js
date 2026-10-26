import WorkbenchTask from '@/models/WorkbenchTask';
import {appendTaskEvent} from '../workbench/events';
import {serializeStoredFile,readStoredFileBuffer} from '../storage/service';
import {inspectUploadedFile} from '../storage/fileInspection';
import {getAttachmentCategory} from '@/lib/shared/attachments';
export async function registerIntegrationFile({userId,task,file,input}){
 if(['image','audio','video'].includes(getAttachmentCategory({extension:file.extension})) || /^(bmp|tif|tiff)$/i.test(file.extension)){
  const media=inspectUploadedFile(input ?? await readStoredFileBuffer(file),file.extension);
  if(!media)throw Object.assign(new Error('文件内容与扩展名不匹配'),{status:400});
  file.category=media.category;file.mimeType=media.mimeType;await file.save();
 }
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
