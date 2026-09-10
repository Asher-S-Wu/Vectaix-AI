import {requireUserRecord,unauthorizedResponse} from '@/lib/server/api/routeHelpers';
import {rateLimit} from '@/lib/rateLimit';
import {readRecordingForm,normalizeRecording} from '@/lib/server/voice/recording';
import {transcribeRecording} from '@/lib/server/voice/transcription';
import {getUserSettings} from '@/lib/server/settings/service';
export const runtime='nodejs';
export async function POST(request) {
  try {
    const auth=await requireUserRecord({request});
    if(!auth)return unauthorizedResponse('请先登录');
    const userId=auth.payload.userId;
    const settings=await getUserSettings(userId);
    if(settings.permissions?.microphone!==true)return Response.json({error:'请先在权限设置中允许使用麦克风'},{status:403});
    if(!rateLimit(`voice-transcribe:${userId}`,{limit:10,windowMs:60000}).success)return Response.json({error:'语音转写请求过于频繁'},{status:429});
    const recording=await normalizeRecording(await readRecordingForm(request),{signal:request.signal});
    const result=await transcribeRecording({userId,recording,clientOperationId:request.headers.get('x-credit-operation-id'),signal:request.signal});
    return Response.json(result,{headers:{'Cache-Control':'no-store'}});
  } catch(error) {
    const status=error.status||error.statusCode||500;
    return Response.json({error:status<500||error.publicMessage?error.message:'语音转写失败，请检查转写模型和服务配置'},{status});
  }
}
