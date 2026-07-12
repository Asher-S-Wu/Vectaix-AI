import dbConnect from '@/lib/db';
import { isAdminEmail, requireAdmin } from '@/lib/admin';
import User from '@/models/User';
import Conversation from '@/models/Conversation';
import UserSettings from '@/models/UserSettings';
import VideoGenerationTask from '@/models/VideoGenerationTask';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { forbiddenResponse } from '@/lib/server/api/routeHelpers';
import { deleteAllStoredFilesForUser } from '@/lib/server/storage/service';
import { deleteAllAuthSessionsForUser } from '@/lib/auth';

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
    const admin = await requireAdmin();
    if (!admin) {
        return forbiddenResponse();
    }

    const { id } = await context.params;
    if (!mongoose.isValidObjectId(id)) {
        return Response.json({ error: '无效的用户 ID' }, { status: 400 });
    }

    await dbConnect();

    const user = await User.findById(id);
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
    const admin = await requireAdmin();
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

    const user = await User.findById(id);
    if (!user) {
        return Response.json({ error: '用户不存在' }, { status: 404 });
    }

    const userId = user._id;

    // 必须先清理挂载硬盘；失败时保留用户与数据库记录，避免产生失联文件。
    await deleteAllStoredFilesForUser(userId);

    // 级联删除所有关联数据
    await Promise.all([
        deleteAllAuthSessionsForUser(userId),
        Conversation.deleteMany({ userId }),
        UserSettings.deleteMany({ userId }),
        VideoGenerationTask.deleteMany({ userId }),
        User.deleteOne({ _id: userId }),
    ]);

    return Response.json({ success: true });
}
