import WorkbenchSkill from "@/models/WorkbenchSkill";
import { workbenchRoute, readBody, textField, booleanField, requireObjectId, workbenchError } from "@/lib/server/workbench/apiHelpers";

async function findSkill(userId, context) {
  const id = requireObjectId((await context.params).id);
  const skill = await WorkbenchSkill.findOne({ userId, _id: id });
  if (!skill) throw workbenchError("技能不存在", 404);
  return skill;
}
export function GET(req, context) {
  return workbenchRoute(req, async (userId) => Response.json({ skill: await findSkill(userId, context) }));
}
export function PUT(req, context) {
  return workbenchRoute(req, async (userId) => {
    const skill = await findSkill(userId, context);
    const body = await readBody(req);
    for (const [key, label, max] of [["name", "技能名称", 100], ["description", "技能介绍", 2000], ["content", "技能内容", 30000]]) {
      if (Object.hasOwn(body, key)) skill[key] = textField(body[key], label, max, key !== "description");
    }
    if (Object.hasOwn(body, "enabled")) skill.enabled = booleanField(body.enabled, "技能状态");
    await skill.save();
    return Response.json({ skill });
  });
}
export function DELETE(req, context) {
  return workbenchRoute(req, async (userId) => {
    const skill = await findSkill(userId, context);
    if (skill.builtinKey) throw workbenchError("内置技能可以关闭，不能删除");
    await skill.deleteOne();
    return Response.json({ success: true });
  });
}
