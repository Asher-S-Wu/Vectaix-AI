import dbConnect from '@/lib/db';
import { isAdminEmail, requireAdmin } from '@/lib/admin';
import User from '@/models/User';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { forbiddenResponse } from '@/lib/server/api/routeHelpers';
import { deleteAllAuthSessionsForUser } from '@/lib/auth';
import { deleteUserAndData } from '@/lib/server/guest/deleteUser';
import { UserOperationLeaseError } from '@/lib/media/server/userOperationLeases';

export const dynamic = 'force-dynamic';

async function parseJsonBody(req) {
    try {
        return await req.json();
    } catch {
        return null;
    }
}

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

    await dbConnect();

    const user = await User.findOne({ _id: id, guestLinkId: { $exists: false } });
    if (!user) {
        return Response.json({ error: '用户不存在' }, { status: 404 });
    }

    const body = await parseJsonBody(req);
    if (body?.action === 'set-advanced-user') {
        if (isAdminEmail(user.email)) {
            return Response.json({ error: '超级管理员不需要调整高级用户权限' }, { status: 400 });
        }

        const nextIsAdvancedUser = body?.isAdvancedUser === true;
        user.isAdvancedUser = nextIsAdvancedUser;
        await user.save();

        return Response.json({
            success: true,
            user: {
                id: user._id.toString(),
                email: user.email,
                isAdmin: false,
                isAdvancedUser: nextIsAdvancedUser,
            },
        });
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

    const user = await User.exists({ _id: id, guestLinkId: { $exists: false } });
    if (!user) return Response.json({ error: '用户不存在' }, { status: 404 });
    try {
        await deleteUserAndData(id);
        return Response.json({ success: true });
    } catch (error) {
        console.error('[AdminUserDelete] 删除用户失败', { errorType: error?.name, code: error?.code });
        return Response.json(
            {
                error: error instanceof UserOperationLeaseError ? error.message : '删除用户失败，账号已保持删除中状态，请稍后重试',
                ...(error instanceof UserOperationLeaseError ? { code: error.code, reconciliation: error.reconciliation } : {}),
            },
            { status: error instanceof UserOperationLeaseError ? error.statusCode : 500 },
        );
    }
}
