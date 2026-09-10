import mongoose from 'mongoose';
const schema=new mongoose.Schema({
 userId:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true,index:true}, name:{type:String,required:true,maxlength:80},
 kind:{type:String,enum:['mcp','webdav','s3','sftp','smb','ftp'],required:true}, enabled:{type:Boolean,default:true},
 config:{type:mongoose.Schema.Types.Mixed,default:{}}, secret:{type:mongoose.Schema.Types.Mixed,select:false},
 tools:{type:[mongoose.Schema.Types.Mixed],default:[]}, resources:{type:[mongoose.Schema.Types.Mixed],default:[]}, prompts:{type:[mongoose.Schema.Types.Mixed],default:[]},
 testedAt:Date, oauthPending:{type:mongoose.Schema.Types.Mixed,select:false},
},{timestamps:true});
export default mongoose.models.UserConnection || mongoose.model('UserConnection',schema);
