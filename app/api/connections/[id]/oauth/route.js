import {workbenchRoute} from '@/lib/server/workbench/apiHelpers';
import {ownedConnection} from '@/lib/server/integrations/connections';
import {beginOAuth} from '@/lib/server/integrations/mcp';
export const runtime='nodejs';
export async function POST(req,context){return workbenchRoute(req,async userId=>{const c=await ownedConnection(userId,(await context.params).id,{secrets:true});if(c.kind!=='mcp'||c.config.authType!=='oauth')throw new Error('此连接未使用 OAuth');const origin=process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;return Response.json(await beginOAuth(c,new URL('/api/connections/oauth/callback',origin).toString()));});}
