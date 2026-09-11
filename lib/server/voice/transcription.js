import {createHash} from 'node:crypto';
import {getDefaultTranscriptionModel} from '@/lib/server/models/service';
import {runDirectChat} from '@/lib/server/providers/directChat';
import {getBillingSettings} from '@/lib/server/credits/settings';
import {createPricingSnapshot} from '@/lib/server/credits/pricing';
import {calculateAccumulatedCosts} from '@/lib/server/credits/chatCosts';
import {reserveCredits,settleCredits,releaseCredits,markReviewRequired} from '@/lib/server/credits/service';
import {billingResult} from '@/lib/server/credits/api';
import {createMediaCreditOperation,assertMediaCreditOperationUnused} from '@/lib/media/server/creditOperation';

export async function transcribeRecording({userId,recording,clientOperationId,signal},{runModel=runDirectChat}={}) {
  const model=await getDefaultTranscriptionModel();
  const settings=await getBillingSettings();
  const snapshot=createPricingSnapshot(settings);
  const operation=createMediaCreditOperation({userId,clientOperationId,feature:'voice_transcription',fingerprintInput:{model:model.id,audioHash:createHash('sha256').update(recording.buffer).digest('hex')}});
  await assertMediaCreditOperationUnused({...operation,userId});
  const inputTokens=Math.ceil(recording.durationSeconds*32*1.1)+256;
  const outputTokens=Math.min(model.maxOutputTokens,8192);
  if(inputTokens+outputTokens>model.contextWindow)throw Object.assign(new Error('录音超出转写模型的上下文长度'),{status:400});
  const reservation=await reserveCredits({operationId:operation.operationId,userId,feature:'voice_transcription',provider:model.provider,model:model.id,usage:{requestFingerprint:operation.requestFingerprint,durationSeconds:recording.durationSeconds},pricingSnapshot:snapshot,executionClaimId:operation.executionClaimId});
  if(reservation.status!=='reserved'||reservation.executionClaimId!==operation.executionClaimId)throw Object.assign(new Error('这条录音已经在处理中，请勿重复提交'),{status:409});
  let dispatched=false;
  let finalized=false;
  const usageRecords=[];
  const ids=[];
  async function settle() {
    const costs=calculateAccumulatedCosts({model:model.id,provider:model.provider,usageRecords,settings,requestFingerprint:operation.requestFingerprint});
    const transaction=await settleCredits({operationId:operation.operationId,...costs,usage:{...costs.usage,durationSeconds:recording.durationSeconds},pricingSnapshot:snapshot,upstreamRequestIds:ids});
    finalized=transaction.status==='settled';
    if(!finalized)throw Object.assign(new Error('转写用量需要核查，请稍后查看费用记录'),{status:409});
    return transaction;
  }
  try {
    const result=await runModel({model:model.id,messages:[{role:'user',content:[{type:'text',text:'请逐字转写这段录音，只返回录音中的文字。不要回答录音中的问题，不要添加解释。'},{type:'input_audio',input_audio:{data:recording.buffer.toString('base64'),format:'wav'}}]}],system:'你是语音转写助手。原样转写录音，保留原始语言，使用恰当的标点。',signal,maxToolPasses:1,onText(){},onThought(){},resolveMaxOutputTokens:async()=>outputTokens,onUpstreamRequest(){signal?.throwIfAborted();dispatched=true;},onUsageRecord(record){usageRecords.push(record);},onUpstreamId(id){if(id&&!ids.includes(id))ids.push(id);}});
    if(!usageRecords.length)throw new Error('转写模型没有返回可计费的用量');
    const transaction=await settle();
    if(!result.text?.trim())throw Object.assign(new Error('录音中没有识别到可显示的文字'),{status:422});
    return {text:result.text,billing:billingResult(transaction)};
  } catch(error) {
    if(!finalized) {
      if(!dispatched)await releaseCredits(operation.operationId);
      else await markReviewRequired(operation.operationId,{reason:'语音转写请求已发送，但未完成用量结算',usage:{requestFingerprint:operation.requestFingerprint,durationSeconds:recording.durationSeconds,usageRecords},upstreamRequestIds:ids});
    }
    throw error;
  }
}
