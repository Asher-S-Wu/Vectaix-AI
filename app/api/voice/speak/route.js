import { localizedRoute } from '@/lib/server/localizedRoute';
import {requireUserRecord,unauthorizedResponse,parseJsonRequest} from '@/lib/server/api/routeHelpers';
import {rateLimit} from '@/lib/rateLimit';
import {getAgentMediaSettings} from '@/lib/server/media/settings';
import {dispatchSpeech} from '@/lib/server/voice/speech.mjs';
import {generateFishSpeech} from '@/lib/media/server/operations/fishSpeech';
import {generateQwenSpeech} from '@/lib/media/server/operations/qwenSpeech';
export const runtime='nodejs';
async function POSTHandler(request) {
  try {
    const auth=await requireUserRecord({request});
    if(!auth)return unauthorizedResponse('请先登录');
    const userId=auth.payload.userId;
    if(!rateLimit(`voice-speak:${userId}`,{limit:10,windowMs:60000}).success)return Response.json({error:'朗读请求过于频繁'},{status:429});
    const parsed=await parseJsonRequest(request,'朗读请求格式无效',131072);if(!parsed.ok)return parsed.response;
    const settings=await getAgentMediaSettings();
    const result=await dispatchSpeech({userId,text:parsed.body.text,audio:settings.audio,clientOperationId:request.headers.get('x-credit-operation-id'),signal:request.signal},{fish:generateFishSpeech,qwen:generateQwenSpeech});
    return Response.json(result.data,{status:result.status,headers:{'Cache-Control':'no-store'}});
  } catch(error) {
    const status=error.status||error.statusCode||500;
    return Response.json({error:status<500?error.message:'朗读失败，请检查配音服务设置'},{status});
  }
}

export const POST = localizedRoute(POSTHandler);
