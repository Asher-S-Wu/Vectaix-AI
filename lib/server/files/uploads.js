import { workbenchError } from '@/lib/server/workbench/apiHelpers';
export async function readMultipart(request, maxBytes) {
  const contentType = request.headers.get('content-type');
  if (!contentType?.startsWith('multipart/form-data;') || !request.body) throw workbenchError('请使用文件上传表单');
  if (Number(request.headers.get('content-length')) > maxBytes) throw workbenchError('上传内容超过大小限制', 413);
  let received = 0;
  const stream = request.body.pipeThrough(new TransformStream({ transform(chunk, controller) { received += chunk.byteLength; if (received > maxBytes) throw workbenchError('上传内容超过大小限制', 413); controller.enqueue(chunk); } }));
  try { return await new Response(stream, { headers: { 'Content-Type': contentType } }).formData(); }
  catch (error) { if (error.status) throw error; throw workbenchError('上传表单无效或超过大小限制'); }
}
