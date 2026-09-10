export async function dispatchSpeech({text,audio,userId,clientOperationId,signal},services) {
  if(typeof text!=='string'||!text.trim()||text.length>32000)throw Object.assign(new Error('朗读文字需要在 1 至 32000 字之间'),{status:400});
  if(!audio||!['qwen','minimax','doubao'].includes(audio.provider)||!audio.voiceId)throw Object.assign(new Error('请先在创作设置中选择配音服务和音色'),{status:400});
  const result=await services[audio.provider]({userId,body:{...audio,text:text.trim()},clientOperationId,signal});
  if(!result.data.success)return result;
  if(!result.data.generation?.audioUrl)throw Object.assign(new Error('配音服务没有返回音频文件'),{status:502});
  return {status:result.status,data:{...result.data,audioUrl:result.data.generation.audioUrl}};
}
