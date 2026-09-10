import http from 'node:http';
import net from 'node:net';
import { publicAddress } from '../integrations/network.mjs';
import { assertPublicUrl } from '../security/publicUrl.mjs';
export async function startPublicProxy({connectPorts=[443,8443],allowedHostname}={}){
 const sockets=new Set();
 const server=http.createServer(async(req,res)=>{
  try{
   const url=await assertPublicUrl(req.url,{protocols:['http:']});if(allowedHostname&&url.hostname!==allowedHostname)throw new Error('连接目标不匹配');const address=await publicAddress(url.hostname);
   const headers={...req.headers};delete headers['proxy-authorization'];delete headers['proxy-connection'];
   const upstream=http.request({host:address.address,port:url.port || 80,path:url.pathname+url.search,method:req.method,headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
   upstream.setTimeout(30000,()=>upstream.destroy());upstream.on('error',()=>{res.destroy();});req.pipe(upstream);
  }catch{res.writeHead(403);res.end('地址不允许访问');}
 });
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 server.on('connect',async(req,client,head)=>{
  try{
   const url=await assertPublicUrl(`https://${req.url}`,{ports:connectPorts});if(allowedHostname&&url.hostname!==allowedHostname)throw new Error('连接目标不匹配');const address=await publicAddress(url.hostname);
   const remote=net.connect({host:address.address,port:Number(url.port)||443},()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)remote.write(head);remote.pipe(client);client.pipe(remote);});
   sockets.add(remote);remote.on('close',()=>sockets.delete(remote));remote.on('error',()=>client.destroy());client.on('error',()=>remote.destroy());client.on('close',()=>remote.destroy());remote.setTimeout(120000,()=>remote.destroy());
  }catch{client.end('HTTP/1.1 403 Forbidden\r\n\r\n');}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return {url:`http://127.0.0.1:${server.address().port}`,close:async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}};
}
