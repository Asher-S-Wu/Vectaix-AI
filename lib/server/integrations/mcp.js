import crypto from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import UserConnection from '@/models/UserConnection';
import { credentials,saveCredentials } from './connections';
import { publicFetch } from './network.mjs';
import { assertPublicUrl } from '../security/publicUrl.mjs';
export async function oauthProvider(connection,{redirectUrl,state,onRedirect}={}){
 const secrets=credentials(connection);
 async function save(){await saveCredentials(connection,secrets);}
 return {
  redirectUrl:redirectUrl || secrets.redirectUrl,
  clientMetadata:{client_name:'Vectaix AI',redirect_uris:[redirectUrl || secrets.redirectUrl],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:secrets.clientInformation?.client_secret?'client_secret_post':'none'},
  state:()=>state,
  clientInformation:()=>secrets.clientInformation,
  async saveClientInformation(value){secrets.clientInformation=value;await save();},
  tokens:()=>secrets.tokens,
  async saveTokens(value){secrets.tokens=value;secrets.tokenExpiresAt=value.expires_in?Date.now()+value.expires_in*1000:null;secrets.redirectUrl=redirectUrl || secrets.redirectUrl;await save();},
  async redirectToAuthorization(url){await assertPublicUrl(url,{protocols:['https:']});if(!onRedirect)throw new Error('请在连接设置中重新授权');await onRedirect(url.toString());},
  async saveCodeVerifier(value){secrets.codeVerifier=value;secrets.redirectUrl=redirectUrl || secrets.redirectUrl;await save();},
  codeVerifier(){if(!secrets.codeVerifier)throw new Error('授权已失效');return secrets.codeVerifier;},
 };
}
export async function beginOAuth(connection,redirectUrl){
 await assertPublicUrl(redirectUrl,{protocols:['https:']});
 const state=crypto.randomBytes(32).toString('hex');let authorizationUrl;
 await UserConnection.updateOne({_id:connection._id,userId:connection.userId},{$set:{oauthPending:{state,expiresAt:new Date(Date.now()+600000)}}});
 const provider=await oauthProvider(connection,{redirectUrl,state,onRedirect:url=>{authorizationUrl=url;}});
 const result=await auth(provider,{serverUrl:new URL(connection.config.url),fetchFn:publicFetch});
 if(result==='AUTHORIZED')await UserConnection.updateOne({_id:connection._id},{$unset:{oauthPending:1}});
 return {authorizationUrl,authorized:result==='AUTHORIZED'};
}
export async function finishOAuth(connection,code){
 const provider=await oauthProvider(connection);
 await auth(provider,{serverUrl:new URL(connection.config.url),authorizationCode:code,fetchFn:publicFetch});
}
export async function connectMcp(connection,{signal}={}){
 let secrets=credentials(connection);let headers={};
 if(connection.config.authType==='oauth' && secrets.tokenExpiresAt && secrets.tokenExpiresAt<Date.now()+30000){await auth(await oauthProvider(connection),{serverUrl:new URL(connection.config.url),fetchFn:publicFetch});secrets=credentials(connection);}
 if(connection.config.authType==='apiKey'){
  if(!secrets.apiKey)throw new Error('请先配置连接密钥');
  headers[connection.config.apiKeyHeader]=connection.config.apiKeyHeader==='Authorization'?`Bearer ${secrets.apiKey}`:secrets.apiKey;
 }
 // Authentication is completed before any tool call. A 401 cannot replay an external write.
 if(connection.config.authType==='oauth'){
  if(!secrets.tokens?.access_token)throw new Error('请先在连接设置中完成授权');
  headers.Authorization=`Bearer ${secrets.tokens.access_token}`;
 }
 const client=new Client({name:'Vectaix',version:'1.0.0'});
 const transport=new StreamableHTTPClientTransport(await assertPublicUrl(connection.config.url,{protocols:['https:']}),{requestInit:{headers,signal},fetch:publicFetch,reconnectionOptions:{maxRetries:0,maxReconnectionDelay:0,initialReconnectionDelay:0,reconnectionDelayGrowFactor:1}});
 try{await client.connect(transport);return client;}catch{await transport.close();throw new Error('连接失败，请检查地址、密钥或重新授权');}
}
export async function testMcp(connection){
 const client=await connectMcp(connection);
 try{
  let tools=[],cursor;do{const result=await client.listTools(cursor?{cursor}:{});tools.push(...result.tools);cursor=result.nextCursor;if(tools.length>200)throw new Error('单个连接最多支持 200 个工具');}while(cursor);
  const caps=client.getServerCapabilities();const resources=caps?.resources?(await client.listResources()).resources:[];const prompts=caps?.prompts?(await client.listPrompts()).prompts:[];
  const enabled=new Set(connection.tools.filter(x=>x.enabled).map(x=>x.name));
  tools=tools.map(t=>({...t,enabled:enabled.has(t.name)}));
  await UserConnection.updateOne({_id:connection._id,userId:connection.userId},{$set:{tools,resources,prompts,testedAt:new Date()}});
  return {tools,resources,prompts};
 }finally{await client.close();}
}
