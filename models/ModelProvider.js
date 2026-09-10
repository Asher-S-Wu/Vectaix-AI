import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  id: { type:String,required:true,unique:true },
  name: { type:String,required:true },
  baseUrl: { type:String,required:true },
  protocol: { type:String,enum:['chat-completions','responses','anthropic','gemini'],required:true },
  encryptedKey: { type:mongoose.Schema.Types.Mixed,select:false },
  enabled: { type:Boolean,required:true },
}, { timestamps:true });
export default mongoose.models.ModelProvider || mongoose.model('ModelProvider',schema);
