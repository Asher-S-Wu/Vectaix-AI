import { cookies } from 'next/headers';
import dbConnect from '@/lib/db';
import { getAuthPayload, startAuthSession } from '@/lib/auth';
import { getUserAccessFlags } from '@/lib/admin';
import { parseJsonRequest } from '@/lib/server/api/routeHelpers';
import { rateLimit, getClientIP } from '@/lib/rateLimit';
import { registrationOptions, registerPasskey, authenticationOptions, authenticatePasskey } from '@/lib/server/auth/passkeys';
import Passkey from '@/models/Passkey';

export async function GET(req) {
  const auth = await getAuthPayload(req);
  if (!auth) return Response.json({ error: '请先登录' }, { status: 401 });
  return Response.json({ passkeys: await Passkey.find({ userId: auth.userId }).select('name createdAt lastUsedAt').lean() });
}
export async function DELETE(req) {
  const auth = await getAuthPayload(req);
  if (!auth) return Response.json({ error: '请先登录' }, { status: 401 });
  const parsed = await parseJsonRequest(req, '请求内容无效', 1024);
  if (!parsed.ok) return parsed.response;
  if (!/^[a-f\d]{24}$/i.test(parsed.body?.id)) return Response.json({ error: '通行密钥不存在' }, { status: 404 });
  const result = await Passkey.deleteOne({ _id: parsed.body.id, userId: auth.userId });
  return result.deletedCount ? Response.json({ success: true }) : Response.json({ error: '通行密钥不存在' }, { status: 404 });
}
export async function POST(req) {
  try {
    if (!rateLimit(`passkey:${getClientIP(req)}`, { limit: 20, windowMs: 60000 }).success) return Response.json({ error: '尝试次数过多，请稍后再试' }, { status: 429 });
    const parsed = await parseJsonRequest(req, '请求内容无效', 65536);
    if (!parsed.ok) return parsed.response;
    const { action, challengeId, response, name } = parsed.body;
    await dbConnect();
    if (action === 'authentication-options') {
      const result = await authenticationOptions();
      (await cookies()).set('passkey_challenge', result.challengeId, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 300, path: '/api/auth/passkeys' });
      return Response.json(result);
    }
    if (action === 'authentication-verify') {
      const jar = await cookies();
      if (!challengeId || jar.get('passkey_challenge')?.value !== challengeId) return Response.json({ error: '验证已过期，请重新开始' }, { status: 400 });
      jar.set('passkey_challenge', '', { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 0, path: '/api/auth/passkeys' });
      const user = await authenticatePasskey(challengeId, response);
      await startAuthSession(user._id);
      return Response.json({ success: true, user: { id: String(user._id), email: user.email, ...getUserAccessFlags(user) } });
    }
    const auth = await getAuthPayload(req);
    if (!auth) return Response.json({ error: '请先登录' }, { status: 401 });
    if (action === 'registration-options') return Response.json(await registrationOptions(auth, name));
    if (action === 'registration-verify') { await registerPasskey(auth, challengeId, response); return Response.json({ success: true }); }
    return Response.json({ error: '不支持的通行密钥操作' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.status ? error.message : '通行密钥验证未完成，请检查网站地址和设备支持情况' }, { status: error.status || 400 });
  }
}
