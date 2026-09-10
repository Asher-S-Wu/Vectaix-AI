import mongoose from 'mongoose';
const schema=new mongoose.Schema({
 userId:{type:mongoose.Schema.Types.ObjectId,required:true,immutable:true,index:true},taskId:{type:mongoose.Schema.Types.ObjectId,required:true,immutable:true,index:true},
 callId:{type:String,required:true,immutable:true}, tool:{type:String,required:true,immutable:true}, arguments:{type:mongoose.Schema.Types.Mixed,required:true,immutable:true},
 snapshot:{type:mongoose.Schema.Types.Mixed,immutable:true,select:false},
 status:{type:String,enum:['pending','approved','rejected','executing','completed','expired','unknown'],default:'pending'},
 expiresAt:{type:Date,required:true,immutable:true}, decidedAt:Date, executionStartedAt:Date,
},{timestamps:true});
schema.index({taskId:1,callId:1},{unique:true});
export default mongoose.models.TaskApproval || mongoose.model('TaskApproval',schema);
