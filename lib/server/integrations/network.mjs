import { lookup } from 'node:dns/promises';
import { Agent, fetch as undiciFetch } from 'undici';
import { assertPublicUrl } from '../security/publicUrl.mjs';
import { isBlockedMediaAddress } from '../../media/server/mediaKit/security.js';
export async function publicAddress(hostname) {
 const results=await lookup(hostname.replace(/^\[|\]$/g,''),{all:true});
 if(!results.length || results.some(x=>isBlockedMediaAddress(x.address))) throw new Error('不能访问内部网络');
 return results[0];
}
const dispatcher=new Agent({connect:{lookup(host,options,callback){publicAddress(host).then(result=>callback(null,options.all?[result]:result.address,result.family),callback);}}});
export async function publicFetch(input,init={}) {
 const url=await assertPublicUrl(input instanceof Request?input.url:String(input));
 const response=await undiciFetch(url,{...init,redirect:'manual',dispatcher,signal:init.signal || AbortSignal.timeout(30000)});
 if(response.status>=300 && response.status<400) {await response.body?.cancel();throw new Error('连接端点发生重定向，请使用最终地址');}
 return response;
}
