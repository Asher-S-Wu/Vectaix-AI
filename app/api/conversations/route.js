import Conversation from '@/models/Conversation';
import { requireProject } from '@/lib/server/workbench/catalog';
import { sanitizeImportedConversation } from '@/lib/server/conversations/sanitize';
import { bindStoredFiles, collectStoredFileIds } from '@/lib/server/storage/service';
import { TEXT_CHAT_MAX_REQUEST_BYTES } from '@/lib/server/chat/routeConstants';
import {
    assertRequestSize,
    parseJsonRequest,
    requireUserRecord,
    unauthorizedResponse,
} from '@/lib/server/api/routeHelpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
    try {
        const auth = await requireUserRecord({ request: req, connectDb: true, select: null });
        const user = auth?.payload;
        if (!user) return unauthorizedResponse();

        const query = { userId: user.userId };
        const searchParams = new URL(req.url).searchParams;
        if (searchParams.has('projectId')) {
            const projectId = searchParams.get('projectId');
            if (projectId && projectId !== 'null') await requireProject(user.userId, projectId);
            query.projectId = projectId && projectId !== 'null' ? projectId : null;
        }
        const conversations = await Conversation.find(query)
            .sort({ pinned: -1, updatedAt: -1 })
            .select('title model updatedAt pinned projectId')
            .lean();

        return Response.json({ conversations });
    } catch (error) {
        console.error('[Conversations] Fetch failed:', {
            errorType: error?.name || 'Error',
            code: error?.code || '',
        });
        return Response.json({ error: error.status ? error.message : 'Internal Server Error' }, { status: error.status || 500 });
    }
}

export async function POST(req) {
    try {
        const oversizeResponse = assertRequestSize(req, TEXT_CHAT_MAX_REQUEST_BYTES);
        if (oversizeResponse) return oversizeResponse;

        const auth = await requireUserRecord({ request: req, connectDb: true, select: null });
        const user = auth?.payload;
        if (!user) return unauthorizedResponse();

        const parsed = await parseJsonRequest(req, "Invalid JSON", TEXT_CHAT_MAX_REQUEST_BYTES);
        if (!parsed.ok) return parsed.response;
        const body = parsed.body;

        const conversationInput = sanitizeImportedConversation(body, 0, user.userId);
        const projectId = body.projectId === undefined ? null : body.projectId;
        if (projectId !== null) await requireProject(user.userId, projectId);
        const created = await Conversation.create({
            ...conversationInput,
            projectId,
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
        return Response.json({ error: error?.message || '创建对话失败' }, { status: error.status || 400 });
    }
}
