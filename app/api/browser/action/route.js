import {workbenchRoute,readBody} from '@/lib/server/workbench/apiHelpers';
import {browserAction,browserStatus} from '@/lib/server/browser/service';
import UserSettings from '@/models/UserSettings';
export const runtime='nodejs';
export async function POST(req){return workbenchRoute(req,async userId=>{const settings=await UserSettings.findOne({userId}).lean();if(settings?.permissions?.browser!==true)throw Object.assign(new Error('请先开启浏览器权限'),{status:403});if(browserStatus(userId).busy)throw Object.assign(new Error('浏览器正忙，请稍后打开'),{status:409});return Response.json(await browserAction({userId,action:await readBody(req),manual:true}));});}
