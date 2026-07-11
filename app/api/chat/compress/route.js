import { getAuthPayload } from '@/lib/auth';
import { rateLimit, getClientIP } from '@/lib/rateLimit';
import dbConnect from '@/lib/db';
import User from '@/models/User';
import { GEMINI_FLASH_MODEL } from '@/lib/shared/models';
import { runDirectChat } from '@/lib/server/providers/directChat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMPRESS_RATE_LIMIT = { limit: 10, windowMs: 60 * 1000 };

const COMPRESS_SYSTEM_PROMPT = `你是一个对话历史压缩器。你的任务是将一段多轮对话压缩成一份简洁的摘要，保留所有关键信息。

要求：
1. 保留对话中所有重要的事实、结论、决策和上下文
2. 保留用户的偏好、需求和约束条件
3. 保留任何代码片段、技术细节或具体数据
4. 保留对话中建立的任何约定或规则
5. 用第三人称描述（"用户提到..."、"助手回答..."）
6. 按时间顺序组织，但合并重复或冗余的内容
7. 摘要应该足够详细，使得一个新的AI助手仅凭这份摘要就能无缝继续对话
8. 直接输出摘要内容，不要加任何前缀说明`;

export async function POST(req) {
    try {
        let body;
        try {
            body = await req.json();
        } catch {
            return Response.json({ error: 'Invalid JSON' }, { status: 400 });
        }

        const { messages } = body;

        if (!Array.isArray(messages) || messages.length === 0) {
            return Response.json({ error: 'Messages are required' }, { status: 400 });
        }

        const auth = await getAuthPayload();
        if (!auth) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const clientIP = getClientIP(req);
        const rateLimitKey = `compress:${auth.userId}:${clientIP}`;
        const { success } = rateLimit(rateLimitKey, COMPRESS_RATE_LIMIT);
        if (!success) {
            return Response.json({ error: '请求过于频繁，请稍后再试' }, { status: 429 });
        }

        await dbConnect();
        const userDoc = await User.findById(auth.userId);
        if (!userDoc) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const conversationText = messages
            .filter(m => m?.role === 'user' || m?.role === 'model')
            .map(m => {
                const role = m.role === 'user' ? '用户' : '助手';
                const content = typeof m.content === 'string' ? m.content : '';
                const truncated = content.length > 8000 ? content.slice(0, 8000) + '...(已截断)' : content;
                return `【${role}】${truncated}`;
            })
            .join('\n\n');

        if (!conversationText.trim()) {
            return Response.json({ error: 'No valid messages to compress' }, { status: 400 });
        }

        let summary = '';
        await runDirectChat({
            model: GEMINI_FLASH_MODEL,
            system: COMPRESS_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: `请将以下对话历史压缩成一份摘要：\n\n${conversationText}` }],
            signal: req?.signal,
            onText: (delta) => { summary += delta; },
            onThought: () => {},
        });

        if (!summary.trim()) {
            return Response.json({ error: '压缩失败，未生成摘要' }, { status: 500 });
        }

        return Response.json({ summary: summary.trim() });
    } catch (error) {
        console.error('[Compress] API error:', {
            errorType: error?.name || 'Error',
        });
        return Response.json(
            { error: error?.message || '压缩失败' },
            { status: 500 }
        );
    }
}
