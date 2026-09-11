export function modelApiError(error) {
  const status=Number.isInteger(error.status)?error.status:500;
  return Response.json({error:status<500||error.publicMessage?error.message:'模型加载失败'}, {status,headers:{'Cache-Control':'no-store'}});
}
