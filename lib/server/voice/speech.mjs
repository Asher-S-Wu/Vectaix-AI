import { ELEVENLABS_AUDIO_TEXT_MAX_LENGTH } from '../../media/shared/elevenlabsAudio.js';
import { MINIMAX_AUDIO_TEXT_MAX_LENGTH } from '../../media/shared/minimaxAudio.js';

const TEXT_MAX_LENGTH = { elevenlabs: ELEVENLABS_AUDIO_TEXT_MAX_LENGTH, minimax: MINIMAX_AUDIO_TEXT_MAX_LENGTH };

export async function dispatchSpeech({text,audio,userId,clientOperationId,signal},services) {
  if(!audio||!Object.hasOwn(TEXT_MAX_LENGTH,audio.provider)||!audio.voiceId)throw Object.assign(new Error('请管理员在后台配置并启用配音服务'),{status:400});
  const maxLength = TEXT_MAX_LENGTH[audio.provider];
  if(typeof text!=='string'||!text.trim()||text.length>maxLength)throw Object.assign(new Error(`朗读文字需要在 1 至 ${maxLength} 字之间`),{status:400});
  const result=await services[audio.provider]({userId,body:{...audio,text:text.trim()},clientOperationId,signal});
  if(!result.data.success)return result;
  if(!result.data.generation?.audioUrl)throw Object.assign(new Error('配音服务没有返回音频文件'),{status:502});
  return {status:result.status,data:{...result.data,audioUrl:result.data.generation.audioUrl}};
}
