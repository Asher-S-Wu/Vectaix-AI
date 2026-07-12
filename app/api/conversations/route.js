import Conversation from '@/models/Conversation';
import { sanitizeImportedConversation } from '@/lib/server/conversations/sanitize';
import { bindStoredFiles, collectStoredFileIds } from '@/lib/server/storage/service';
import { MAX_REQUEST_BYTES } from '@/lib/server/chat/routeConstants';
import {
    assertRequestSize,
    parseJsonRequest,
    requireUserRecord,
    unauthorizedResponse,
} from '@/lib/server/api/routeHelpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const auth = await requireUserRecord({ connectDb: true, select: null });
        const user = auth?.payload;
        if (!user) return unauthorizedResponse();

        const conversations = await Conversation.find({ userId: user.userId })
            .sort({ pinned: -1, updatedAt: -1 })
            .select('title model updatedAt pinned')
            .lean();

        return Response.json({ conversations });
    } catch (error) {
        console.error('[Conversations] Fetch failed:', {
            errorType: error?.name || 'Error',
            code: error?.code || '',
        });
        return Response.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function POST(req) {
    try {
        const oversizeResponse = assertRequestSize(req, MAX_REQUEST_BYTES);
        if (oversizeResponse) return oversizeResponse;

        const auth = await requireUserRecord({ connectDb: true, select: null });
        const user = auth?.payload;
        if (!user) return unauthorizedResponse();

        const parsed = await parseJsonRequest(req);
        if (!parsed.ok) return parsed.response;
        const body = parsed.body;

        const conversationInput = sanitizeImportedConversation(body, 0, user.userId);
        const created = await Conversation.create({
            ...conversationInput,
            pinned: Boolean(conversationInput.pinned),
            updatedAt: new Date(),
        });
        try {
            await bindStoredFiles({
                userId: user.userId,
                fileIds: collectStoredFileIds(conversationInput.messages),
                ownerType: 'conversation',
                ownerId: created._id,
            });
        } catch (error) {
            await Conversation.deleteOne({ _id: created._id, userId: user.userId });
            throw error;
        }

        return Response.json({ conversation: created.toObject() });
    } catch (error) {
        return Response.json({ error: error?.message || '创建会话失败' }, { status: 400 });
    }
}
