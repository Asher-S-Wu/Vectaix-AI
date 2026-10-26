import { localizedRoute } from '@/lib/server/localizedRoute';
import crypto from 'node:crypto';
import {cookies} from 'next/headers';
import {workbenchRoute} from '@/lib/server/workbench/apiHelpers';
import {ownedConnection,assertExternalToolsEnabled} from '@/lib/server/integrations/connections';
import {beginOAuth} from '@/lib/server/integrations/mcp';
export const runtime='nodejs';
async function POSTHandler(req,context){
 return workbenchRoute(req,async(userId,session)=>{
  await assertExternalToolsEnabled(userId);
  const c=await ownedConnection(userId,(await context.params).id,{secrets:true});
  if(c.kind!=='mcp'||c.config.authType!=='oauth')throw new Error('此连接未使用 OAuth');
  const origin=process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  const nonce=crypto.randomBytes(32).toString('hex');
  const {state,...result}=await beginOAuth(c,new URL('/api/connections/oauth/callback',origin).toString(),{sessionId:session.sessionId,nonceHash:crypto.createHash('sha256').update(nonce).digest('hex')});
  if(result.authorizationUrl)(await cookies()).set(`mcp_oauth_${state}`,nonce,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:600,path:'/api/connections/oauth/callback'});
  return Response.json(result);
 });
}

export const POST = localizedRoute(POSTHandler);
