import { localizedRoute } from '@/lib/server/localizedRoute';
import { requireProject, deleteProjectForUser } from "@/lib/server/workbench/catalog";
import { workbenchRoute, readBody, textField } from "@/lib/server/workbench/apiHelpers";

function GETHandler(req, context) {
  return workbenchRoute(req, async (userId) => Response.json({ project: await requireProject(userId, (await context.params).id) }));
}

function PUTHandler(req, context) {
  return workbenchRoute(req, async (userId) => {
    const project = await requireProject(userId, (await context.params).id);
    const body = await readBody(req);
    for (const [key, label, max] of [["name", "项目名称", 100], ["description", "项目介绍", 2000], ["instructions", "项目指令", 20000]]) {
      if (Object.hasOwn(body, key)) project[key] = textField(body[key], label, max, key === "name");
    }
    await project.save();
    return Response.json({ project });
  });
}

function DELETEHandler(req, context) {
  return workbenchRoute(req, async userId => Response.json(await deleteProjectForUser(userId, (await context.params).id)));
}

export const GET = localizedRoute(GETHandler);
export const PUT = localizedRoute(PUTHandler);
export const DELETE = localizedRoute(DELETEHandler);
