import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  id: { type:String,required:true,unique:true },
  name: { type:String,required:true },
  providerId: { type:String,required:true,index:true },
  upstreamModel: { type:String,required:true },
  group: { type:String,required:true },
  enabled: { type:Boolean,required:true },
  isDefault: { type:Boolean,required:true },
  sortOrder: { type:Number,required:true },
  contextWindow: { type:Number,required:true },
  maxOutputTokens: { type:Number,required:true },
  nativeInputs: [String],
  supportsTools: Boolean,
  supportsWebSearch: Boolean,
  pricing: { type:mongoose.Schema.Types.Mixed,required:true },
  billingMode: { type:String,enum:['tokens','upstream-cost'],required:true },
  requestOptions: { type:mongoose.Schema.Types.Mixed,required:true },
}, { timestamps:true,minimize:false });
schema.index({isDefault:1},{unique:true,partialFilterExpression:{isDefault:true}});
export default mongoose.models.ManagedModel || mongoose.model('ManagedModel',schema);
