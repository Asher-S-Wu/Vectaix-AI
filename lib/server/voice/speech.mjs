import { FISH_AUDIO_TEXT_MAX_LENGTH } from '../../media/shared/fishAudio.js';

export async function dispatchSpeech({text,audio,userId,clientOperationId,signal},services) {
  if(typeof text!=='string'||!text.trim()||text.length>FISH_AUDIO_TEXT_MAX_LENGTH)throw Object.assign(new Error(`朗读文字需要在 1 至 ${FISH_AUDIO_TEXT_MAX_LENGTH} 字之间`),{status:400});
  if(!audio||audio.provider!=='fish'||!audio.voiceId)throw Object.assign(new Error('请管理员在后台配置并启用配音服务'),{status:400});
  const result=await services[audio.provider]({userId,body:{...audio,text:text.trim()},clientOperationId,signal});
  if(!result.data.success)return result;
  if(!result.data.generation?.audioUrl)throw Object.assign(new Error('配音服务没有返回音频文件'),{status:502});
  return {status:result.status,data:{...result.data,audioUrl:result.data.generation.audioUrl}};
}
