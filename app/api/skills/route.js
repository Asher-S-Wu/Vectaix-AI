import WorkbenchSkill from "@/models/WorkbenchSkill";
import { ensureBuiltinSkills } from "@/lib/server/workbench/catalog";
import { workbenchRoute, readBody, textField, booleanField } from "@/lib/server/workbench/apiHelpers";

export function GET(req) {
  return workbenchRoute(req, async (userId) => {
    await ensureBuiltinSkills(userId);
    return Response.json({ skills: await WorkbenchSkill.find({ userId }).sort({ createdAt: 1 }).lean() });
  });
}

export function POST(req) {
  return workbenchRoute(req, async (userId) => {
    const body = await readBody(req);
    const skill = await WorkbenchSkill.create({ userId,
      name: textField(body.name, "技能名称", 100, true),
      description: body.description === undefined ? "" : textField(body.description, "技能介绍", 2000),
      content: textField(body.content, "技能内容", 30000, true),
      enabled: body.enabled === undefined ? true : booleanField(body.enabled, "技能状态"),
    });
    return Response.json({ skill }, { status: 201 });
  });
}
