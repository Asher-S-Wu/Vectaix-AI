import dbConnect from '@/lib/db';
import User from '@/models/User';
import bcrypt from 'bcryptjs';
import { getAuthPayload, replaceAuthSessionsForUser } from '@/lib/auth';
import { validatePassword } from '@/lib/server/auth/validation';

export async function POST(req) {
  try {
    await dbConnect();
    const auth = await getAuthPayload();
    if (!auth) {
      return Response.json({ error: '登录已过期，请重新登录' }, { status: 401 });
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: '请求体格式错误' }, { status: 400 });
    }

    const { oldPassword, newPassword, confirmNewPassword } = body || {};

    if (!oldPassword || !newPassword || !confirmNewPassword) {
      return Response.json({ error: '请填写所有密码字段' }, { status: 400 });
    }

    if (newPassword !== confirmNewPassword) {
      return Response.json({ error: '两次输入的新密码不一致' }, { status: 400 });
    }

    const userDoc = await User.findById(auth.userId);
    if (!userDoc) {
      return Response.json({ error: '用户不存在' }, { status: 404 });
    }

    const isMatch = await bcrypt.compare(oldPassword, userDoc.password);
    if (!isMatch) {
      return Response.json({ error: '当前密码错误' }, { status: 400 });
    }

    const passwordCheck = validatePassword(newPassword);
    if (!passwordCheck.valid) {
      return Response.json({ error: passwordCheck.message }, { status: 400 });
    }

    const hashedNew = await bcrypt.hash(newPassword, 10);
    userDoc.password = hashedNew;
    await userDoc.save();
    await replaceAuthSessionsForUser(userDoc._id);

    return Response.json({ success: true });

  } catch (error) {
    console.error('[Auth] Change password error:', {
      errorType: error?.name || 'Error',
      code: error?.code || '',
    });
    return Response.json({ error: '修改密码失败，请稍后再试' }, { status: 500 });
  }
}
