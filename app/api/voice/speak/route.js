import {requireUserRecord,unauthorizedResponse,parseJsonRequest} from '@/lib/server/api/routeHelpers';
import {rateLimit} from '@/lib/rateLimit';
import {getUserSettings} from '@/lib/server/settings/service';
import {dispatchSpeech} from '@/lib/server/voice/speech.mjs';
import {generateQwenSpeech} from '@/lib/media/server/operations/qwenSpeech';
import {generateMinimaxSpeech} from '@/lib/media/server/operations/minimaxSpeech';
import {generateDoubaoSpeech} from '@/lib/media/server/operations/doubaoSpeech';
export const runtime='nodejs';
export async function POST(request) {
  try {
    const auth=await requireUserRecord({request});
    if(!auth)return unauthorizedResponse('请先登录');
    const userId=auth.payload.userId;
    if(!rateLimit(`voice-speak:${userId}`,{limit:10,windowMs:60000}).success)return Response.json({error:'朗读请求过于频繁'},{status:429});
    const parsed=await parseJsonRequest(request,'朗读请求格式无效',131072);if(!parsed.ok)return parsed.response;
    const settings=await getUserSettings(userId);
    const result=await dispatchSpeech({userId,text:parsed.body.text,audio:settings.chatMediaSettings?.audio,clientOperationId:request.headers.get('x-credit-operation-id'),signal:request.signal},{qwen:generateQwenSpeech,minimax:generateMinimaxSpeech,doubao:generateDoubaoSpeech});
    return Response.json(result.data,{status:result.status,headers:{'Cache-Control':'no-store'}});
  } catch(error) {
    const status=error.status||error.statusCode||500;
    return Response.json({error:status<500?error.message:'朗读失败，请检查配音服务设置'},{status});
  }
}
