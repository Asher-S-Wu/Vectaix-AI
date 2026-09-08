import dbConnect from '@/lib/db';
import { isAdminEmail, requireAdmin } from '@/lib/admin';
import User from '@/models/User';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { forbiddenResponse, parseJsonRequest } from '@/lib/server/api/routeHelpers';
import { deleteAllAuthSessionsForUser } from '@/lib/auth';
import { deleteUserAndData } from '@/lib/server/users/deleteUser';
import { UserOperationLeaseError } from '@/lib/media/server/userOperationLeases';
import { CreditError } from '@/lib/server/credits/errors';

export const dynamic = 'force-dynamic';

// 重置用户密码
export async function PATCH(req, context) {
    const admin = await requireAdmin(req);
    if (!admin) {
        return forbiddenResponse();
    }

    const { id } = await context.params;
    if (!mongoose.isValidObjectId(id)) {
        return Response.json({ error: '无效的用户 ID' }, { status: 400 });
    }

    const parsed = await parseJsonRequest(req, '请求体格式错误');
    if (!parsed.ok) return parsed.response;
    if (parsed.body?.action !== 'reset-password') {
        return Response.json({ error: '不支持的操作' }, { status: 400 });
    }

    await dbConnect();

    const user = await User.findOne({ _id: id });
    if (!user) {
        return Response.json({ error: '用户不存在' }, { status: 404 });
    }

    if (isAdminEmail(user.email)) {
        return Response.json({ error: '不能重置其他超级管理员的密码' }, { status: 403 });
    }

    // 生成随机密码（12 位，包含大小写字母和数字）
    const newPassword = crypto.randomBytes(9).toString('base64url').slice(0, 12);
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    await deleteAllAuthSessionsForUser(user._id);

    return Response.json({ success: true, newPassword });
}

// 删除用户及其所有数据
export async function DELETE(req, context) {
    const admin = await requireAdmin(req);
    if (!admin) {
        return forbiddenResponse();
    }

    const { id } = await context.params;
    if (!mongoose.isValidObjectId(id)) {
        return Response.json({ error: '无效的用户 ID' }, { status: 400 });
    }

    // 不能删除自己
    if (admin.userId === id) {
        return Response.json({ error: '不能删除自己的账号' }, { status: 400 });
    }

    await dbConnect();

    const user = await User.findById(id).select('email').lean();
    if (!user) return Response.json({ error: '用户不存在' }, { status: 404 });
    if (isAdminEmail(user.email)) {
        return Response.json({ error: '不能删除其他超级管理员账号' }, { status: 403 });
    }
    try {
        await deleteUserAndData(id);
        return Response.json({ success: true });
    } catch (error) {
        console.error('[AdminUserDelete] 删除用户失败', { errorType: error?.name, code: error?.code });
        const knownError = error instanceof UserOperationLeaseError || error instanceof CreditError;
        return Response.json(
            {
                error: knownError ? error.message : '删除用户失败，账号已保持删除中状态，请稍后重试',
                ...(error instanceof UserOperationLeaseError ? { code: error.code, reconciliation: error.reconciliation } : {}),
                ...(error instanceof CreditError ? { code: error.code } : {}),
            },
            { status: knownError ? error.statusCode : 500 },
        );
    }
}
