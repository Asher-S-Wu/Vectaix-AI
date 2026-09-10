import {saveModel} from '../../lib/server/models/service.js';
import {testManagedModel} from '../../lib/server/models/api.js';
import {runNativeChat} from '../../lib/server/providers/nativeProtocols.mjs';

export async function saveTestedModel(input) {
  await saveModel({...input,enabled:false,isDefault:false,isTranscriptionDefault:false},{create:true});
  await testManagedModel(input.id,{runModel:(options,{model,provider})=>runNativeChat({...options,modelConfig:model,provider,fetchImpl:async()=>new Response(`data: ${JSON.stringify({candidates:[{content:{parts:[{text:'连接成功'}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:2}})}\n\n`,{headers:{'content-type':'text/event-stream'}})})});
  return saveModel({...input,enabled:true});
}
