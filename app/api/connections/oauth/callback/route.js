import dbConnect from '@/lib/db';
import UserConnection from '@/models/UserConnection';
import User from '@/models/User';
import {finishOAuth} from '@/lib/server/integrations/mcp';
export const runtime='nodejs';
export async function GET(req){
 try{
  const url=new URL(req.url);const state=url.searchParams.get('state');const code=url.searchParams.get('code');
  if(!state||!/^[a-f0-9]{64}$/.test(state)||!code||code.length>4096)return Response.json({error:'授权未完成'},{status:400});
  await dbConnect();
  // The session cookie is SameSite=Strict, so the provider's cross-site callback
  // uses the one-time state and the connection's encrypted PKCE verifier.
  const c=await UserConnection.findOneAndUpdate({'oauthPending.state':state,'oauthPending.expiresAt':{$gt:new Date()}},{$unset:{oauthPending:1}},{new:false}).select('+secret').lean();
  if(!c||!await User.exists({_id:c.userId,deletionInProgress:{$ne:true}}))return Response.json({error:'授权请求已失效'},{status:400});
  await finishOAuth(c,code);
  return new Response('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>授权完成</title><body style="font-family:system-ui;padding:48px">授权已完成，可以关闭此页面并回到连接设置测试连接。</body></html>',{headers:{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"}});
 }catch{return Response.json({error:'授权未完成，请回到设置重新发起授权'},{status:400});}
}
