import { localizedRoute } from '@/lib/server/localizedRoute';
import WorkspaceProject from "@/models/WorkspaceProject";
import { workbenchRoute, readBody, textField, booleanField } from "@/lib/server/workbench/apiHelpers";

function GETHandler(req) {
  return workbenchRoute(req, async (userId) => Response.json({ projects: await WorkspaceProject.find({ userId }).sort({ updatedAt: -1 }).lean() }));
}

function POSTHandler(req) {
  return workbenchRoute(req, async (userId) => {
    const body = await readBody(req);
    const project = await WorkspaceProject.create({
      userId,
      name: textField(body.name, "项目名称", 100, true),
      description: body.description === undefined ? "" : textField(body.description, "项目介绍", 2000),
      instructions: body.instructions === undefined ? "" : textField(body.instructions, "项目指令", 20000),
    });
    return Response.json({ project }, { status: 201 });
  });
}

export const GET = localizedRoute(GETHandler);
export const POST = localizedRoute(POSTHandler);
