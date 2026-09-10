import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import http from 'node:http';
import {MongoMemoryServer} from 'mongodb-memory-server';
import BrowserSession from '../models/BrowserSession';
import {browserAction,acquireBrowser,browserStatus,closeBrowser,prepareBrowserAction} from '../lib/server/browser/service';
import {startPublicProxy} from '../lib/server/browser/proxy';
let mongo;const userId=new mongoose.Types.ObjectId().toString();const other=new mongoose.Types.ObjectId().toString();
before(async()=>{process.env.APP_SECRETS_KEY=Buffer.alloc(32,9).toString('base64');mongo=await MongoMemoryServer.create();await mongoose.connect(mongo.getUri());});
after(async()=>{await closeBrowser(userId,{revoke:true});await closeBrowser(other,{revoke:true});await mongoose.disconnect();await mongo.stop();});
test('browser proxy blocks both HTTP requests and HTTPS tunnels to the local network',async()=>{
 const proxy=await startPublicProxy();
 try{
  const status=await new Promise((resolve,reject)=>{const req=http.request(proxy.url,{path:'http://127.0.0.1:22/'},r=>{r.resume();resolve(r.statusCode);});req.on('error',reject);req.end();});assert.equal(status,403);
  const tunnel=await new Promise((resolve,reject)=>{const req=http.request(proxy.url,{method:'CONNECT',path:'127.0.0.1:443'});req.on('connect',(r,socket)=>{socket.destroy();resolve(r.statusCode);});req.on('error',reject);req.end();});assert.equal(tunnel,403);
 }finally{await proxy.close();}
});
test('one isolated browser session limits tabs, queues other users, and supports revocation',async()=>{
 const view=await browserAction({userId,action:{action:'observe'},manual:true});assert.match(view.screenshot,/^data:image\/jpeg;base64,/);
 assert.equal(browserStatus(userId).tabs.length,1);assert.equal(browserStatus(other).tabs.length,0);assert.equal(browserStatus(other).busy,true);
 await browserAction({userId,action:{action:'new_tab'},manual:true});await browserAction({userId,action:{action:'new_tab'},manual:true});
 await assert.rejects(()=>browserAction({userId,action:{action:'new_tab'},manual:true}),/最多/);
 await assert.rejects(()=>browserAction({userId,action:{action:'navigate',url:'http://localhost/'},manual:true}),/内部网络/);
 const controller=new AbortController();const queued=acquireBrowser(other,'task2',controller.signal);setTimeout(()=>controller.abort(),100);await assert.rejects(()=>queued);assert.equal(browserStatus(other).queued,0);
 await closeBrowser(userId);const saved=await BrowserSession.findOne({userId}).select('+storageState').lean();assert.ok(saved.storageState.data);assert.equal(browserStatus(other).busy,false);
 await closeBrowser(userId,{revoke:true});assert.equal(await BrowserSession.countDocuments({userId}),0);
});
test('a manual login session can be handed to a queued task without losing its tabs',async()=>{
 await browserAction({userId,action:{action:'new_tab'},manual:true});assert.equal(browserStatus(userId).tabs.length,1);
 const waiting=acquireBrowser(userId,'queued-task',AbortSignal.timeout(3000));
 await browserAction({userId,action:{action:'resume'},manual:true});
 const session=await waiting;assert.equal(session.taskId,'queued-task');assert.equal(session.manual,false);assert.equal(session.pages.size,1);
 await closeBrowser(userId,{revoke:true});
});

test('changing a form after review prevents a previously confirmed browser click',async()=>{
 const session=await acquireBrowser(userId,'frozen-task');const page=session.context.pages()[0];
 await page.setContent('<form><input name="destination" value="approved"><button type="button">Submit</button></form>');
 await browserAction({userId,taskId:'frozen-task',action:{action:'observe'}});
 const action={action:'click',element:1};const frozen=await prepareBrowserAction({userId,taskId:'frozen-task',action});
 await page.locator('input').fill('changed-after-review');
 await assert.rejects(()=>browserAction({userId,taskId:'frozen-task',action,frozen}),error=>error.code==='APPROVAL_TARGET_CHANGED'&&error.stopTask===true);
 await frozen.target.dispose();await closeBrowser(userId,{revoke:true});
});
test('stopping a task interrupts a browser action that is waiting for a page element',async()=>{
 const session=await acquireBrowser(userId,'abort-task');await session.context.pages()[0].setContent('<button disabled>Waiting</button>');
 await browserAction({userId,taskId:'abort-task',action:{action:'observe'}});
 const controller=new AbortController();const started=Date.now();const action=browserAction({userId,taskId:'abort-task',action:{action:'click',element:0},signal:controller.signal});setTimeout(()=>controller.abort(),50);
 await assert.rejects(()=>action);await closeBrowser(userId,{taskId:'abort-task'});assert.ok(Date.now()-started<2000);assert.equal(browserStatus(userId).active,false);
});
