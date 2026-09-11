import CreditTransaction from '@/models/CreditTransaction';
import { CreditError } from './errors';

export async function closeUserCostsForDeletion(userId) {
  const active = await CreditTransaction.exists({ userId, status: { $in: ['pending', 'reserved', 'settling'] }, executionClaimId: { $type: 'string', $ne: '' } });
  if (active) throw new CreditError('该用户仍有正在执行的模型请求，请等待请求完成后再删除', { code: 'ACTIVE_MODEL_REQUEST', statusCode: 409 });
}
