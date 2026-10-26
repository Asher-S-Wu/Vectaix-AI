import { localizedRoute } from '@/lib/server/localizedRoute';
import crypto from 'node:crypto';
import {cookies} from 'next/headers';
import dbConnect from '@/lib/db';
import UserConnection from '@/models/UserConnection';
import User from '@/models/User';
import Session from '@/models/Session';
import { getRequestLocale } from '@/lib/server/i18n';
import { localeTag, translate } from '@/lib/shared/i18n.mjs';
import {finishOAuth} from '@/lib/server/integrations/mcp';
import {assertExternalToolsEnabled} from '@/lib/server/integrations/connections';
export const runtime='nodejs';
async function GETHandler(req){
 try{
  const url=new URL(req.url);const state=url.searchParams.get('state');const code=url.searchParams.get('code');
  if(!state||!/^[a-f0-9]{64}$/.test(state)||!code||code.length>4096)return Response.json({error:'授权未完成'},{status:400});
  const jar=await cookies();const cookieName=`mcp_oauth_${state}`;const nonce=jar.get(cookieName)?.value;
  if(!nonce||!/^[a-f0-9]{64}$/.test(nonce))return Response.json({error:'授权请求已失效'},{status:400});
  await dbConnect();
  const pending={'oauthPending.state':state,'oauthPending.nonceHash':crypto.createHash('sha256').update(nonce).digest('hex'),'oauthPending.expiresAt':{$gt:new Date()}};
  const connection=await UserConnection.findOne(pending).select('+oauthPending').lean();
  if(!connection)return Response.json({error:'授权请求已失效'},{status:400});
  const [session,user]=await Promise.all([
   Session.exists({_id:connection.oauthPending.sessionId,userId:connection.userId,expiresAt:{$gt:new Date()}}),
   User.exists({_id:connection.userId,deletionInProgress:{$ne:true}}),
  ]);
  if(!session||!user)return Response.json({error:'授权请求已失效'},{status:400});
  await assertExternalToolsEnabled(connection.userId);
  const c=await UserConnection.findOneAndUpdate({_id:connection._id,userId:connection.userId,...pending},{$unset:{oauthPending:1}},{new:false}).select('+secret').lean();
  if(!c)return Response.json({error:'授权请求已失效'},{status:400});
  jar.set(cookieName,'',{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:0,path:'/api/connections/oauth/callback'});
  await finishOAuth(c,code);
  const locale = getRequestLocale(req);
  const title = translate(locale, '授权完成', 'Connected');
  const message = translate(locale, '授权已完成，可以关闭此页面，回到连接设置测试连接。', 'Authorization is complete. Close this page and return to Settings to test the connection.');
  return new Response(`<!doctype html><html lang="${localeTag(locale)}"><meta charset="utf-8"><meta name="color-scheme" content="light dark"><title>${title}</title><body style="font-family:system-ui;padding:48px">${message}</body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"}});
 }catch(error){return Response.json({error:error.status ? error.message : '授权未完成，请回到设置重新发起授权'},{status:error.status || 400});}
}

export const GET = localizedRoute(GETHandler);
