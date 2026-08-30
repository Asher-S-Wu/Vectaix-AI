import dbConnect from '@/lib/db';
import { getUserAccessFlags, requireAdmin } from '@/lib/admin';
import User from '@/models/User';
import Conversation from '@/models/Conversation';
import { forbiddenResponse } from '@/lib/server/api/routeHelpers';

export const dynamic = 'force-dynamic';

function escapeRegex(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function GET(req) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return forbiddenResponse();
  }

  await dbConnect();

  const { searchParams } = new URL(req.url);
  const search = searchParams.get('search')?.trim() || '';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = 20;
  const skip = (page - 1) * limit;

  const safeSearch = search.slice(0, 100);
  const filter = { guestLinkId: { $exists: false } };
  if (safeSearch) filter.email = { $regex: escapeRegex(safeSearch), $options: 'i' };

  const [users, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('email createdAt isAdvancedUser')
      .lean(),
    User.countDocuments(filter),
  ]);

  // 批量查询每个用户的对话数
  const userIds = users.map(u => u._id);
  const convCounts = await Conversation.aggregate([
    { $match: { userId: { $in: userIds } } },
    { $group: { _id: '$userId', count: { $sum: 1 } } },
  ]);
  const countMap = {};
  for (const c of convCounts) {
    countMap[c._id.toString()] = c.count;
  }

  const result = users.map(u => ({
    ...getUserAccessFlags(u),
    id: u._id.toString(),
    email: u.email,
    createdAt: u.createdAt,
    conversationCount: countMap[u._id.toString()] || 0,
  }));

  return Response.json({
    users: result,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
}
