import dbConnect from '@/lib/db';
import { getUserAccessFlags } from '@/lib/admin';
import User from '@/models/User';
import bcrypt from 'bcryptjs';
import { startAuthSession } from '@/lib/auth';
import { rateLimit, getClientIP } from '@/lib/rateLimit';
import { isValidEmail, normalizeEmail, validatePassword } from '@/lib/server/auth/validation';

const REGISTER_RATE_LIMIT = { limit: 3, windowMs: 10 * 60 * 1000 };

export async function POST(req) {
    try {
        const clientIP = getClientIP(req);
        const rateLimitKey = `register:${clientIP}`;
        const { success, resetTime } = rateLimit(rateLimitKey, REGISTER_RATE_LIMIT);

        if (!success) {
            const retryAfter = Math.ceil((resetTime - Date.now()) / 1000);
            return Response.json(
                { error: '注册尝试次数过多，请稍后再试' },
                {
                    status: 429,
                    headers: { 'Retry-After': String(retryAfter) },
                }
            );
        }

        await dbConnect();
        let body;
        try {
            body = await req.json();
        } catch {
            return Response.json({ error: '请求体格式错误' }, { status: 400 });
        }

        const { email, password, confirmPassword } = body || {};
        if (
            typeof email !== 'string'
            || typeof password !== 'string'
            || typeof confirmPassword !== 'string'
        ) {
            return Response.json({ error: '邮箱或密码格式错误' }, { status: 400 });
        }

        if (!email || !password || !confirmPassword) {
            return Response.json({ error: '请填写所有必填字段' }, { status: 400 });
        }

        const normalizedEmail = normalizeEmail(email);

        if (!isValidEmail(normalizedEmail)) {
            return Response.json({ error: '请输入有效的邮箱地址' }, { status: 400 });
        }

        const passwordCheck = validatePassword(password);
        if (!passwordCheck.valid) {
            return Response.json({ error: passwordCheck.message }, { status: 400 });
        }

        if (password !== confirmPassword) {
            return Response.json({ error: '两次输入的密码不一致' }, { status: 400 });
        }

        const existingUser = await User.findOne({ email: normalizedEmail });
        if (existingUser) {
            return Response.json({ error: '该邮箱已注册' }, { status: 400 });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await User.create({
            email: normalizedEmail,
            password: hashedPassword,
        });

        await startAuthSession(user._id);

        return Response.json({
            success: true,
            user: {
                id: user._id,
                email: user.email,
                ...getUserAccessFlags(user),
            }
        });

    } catch (error) {
        console.error('[Auth] Register error:', {
            errorType: error?.name || 'Error',
            code: error?.code || '',
        });
        return Response.json({ error: '注册失败，请稍后再试' }, { status: 500 });
    }
}
