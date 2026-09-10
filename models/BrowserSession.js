import mongoose from 'mongoose';
const schema=new mongoose.Schema({userId:{type:mongoose.Schema.Types.ObjectId,required:true,unique:true},storageState:{type:mongoose.Schema.Types.Mixed,select:false},savedAt:Date},{timestamps:true});
export default mongoose.models.BrowserSession || mongoose.model('BrowserSession',schema);
