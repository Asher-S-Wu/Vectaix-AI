import { localizedRoute } from '@/lib/server/localizedRoute';
import { workbenchRoute } from '@/lib/server/workbench/apiHelpers';
import { toolLogs, usageSummary } from '@/lib/server/usage/service';
import { getRequestLocale } from '@/lib/server/i18n';
import { translate } from '@/lib/shared/i18n.mjs';

function GETHandler(req) {
  return workbenchRoute(req, async userId => {
    const params = new URL(req.url).searchParams;
    const [usage, events] = await Promise.all([usageSummary(userId, params), toolLogs(userId, params, 2000)]);
    const contains = translate(getRequestLocale(req),
      '用量、任务状态和工具名称；不包含对话正文、输入参数、工具返回内容和凭据。',
      'Usage, task status, and tool names. Conversation text, arguments, tool output, and credentials are excluded.');
    return Response.json({ createdAt: new Date(), usage, events, contains }, {
      headers: { 'Content-Disposition': 'attachment; filename="huajuan-diagnostics.json"', 'Cache-Control': 'no-store' },
    });
  });
}

export const GET = localizedRoute(GETHandler);
