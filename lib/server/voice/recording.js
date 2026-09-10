import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import {inspectAudioMetadata} from '@/lib/media/server/audioSampleInspection';
const execute=promisify(execFile);
export const RECORDING_MAX_BYTES=20*1024*1024;
const formats={'audio/wav':'wav','audio/x-wav':'wav','audio/mpeg':'mp3','audio/mp3':'mp3','audio/webm':'matroska','audio/ogg':'ogg','audio/mp4':'mov','audio/x-m4a':'mov'};
export async function readRecordingForm(request) {
  const reader=request.body?.getReader();
  if (!reader) throw Object.assign(new Error('缺少录音文件'),{status:400});
  const chunks=[];let size=0;
  try {
    for (;;) {
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>RECORDING_MAX_BYTES+65536)throw Object.assign(new Error('录音不能超过 20MB'),{status:413});
      chunks.push(value);
    }
  } finally {await reader.cancel();reader.releaseLock();}
  const form=await new Response(Buffer.concat(chunks),{headers:{'content-type':request.headers.get('content-type')||''}}).formData();
  return form.get('file');
}
export async function normalizeRecording(file,{signal}={}) {
  const mime=file?.type?.split(';')[0];
  if (!(file instanceof File)||!formats[mime]||file.size<1)throw Object.assign(new Error('请上传有效的音频文件'),{status:400});
  if(file.size>RECORDING_MAX_BYTES)throw Object.assign(new Error('录音不能超过 20MB'),{status:413});
  const directory=await mkdtemp(path.join(tmpdir(),'vectaix-recording-'));
  const inputPath=path.join(directory,'recording');
  const outputPath=path.join(directory,'normalized.wav');
  try {
    await writeFile(inputPath,Buffer.from(await file.arrayBuffer()),{mode:0o600});
    try {
      await execute(ffmpegPath,['-nostdin','-hide_banner','-loglevel','error','-protocol_whitelist','file,pipe','-f',formats[mime],'-i',inputPath,'-t','601','-map','0:a:0','-vn','-sn','-dn','-ac','1','-ar','16000','-c:a','pcm_s16le',outputPath],{signal,timeout:60000,maxBuffer:262144});
    } catch(error) {if(signal?.aborted)throw error;throw Object.assign(new Error('录音无法解码，请重新录制或上传有效音频'),{status:400});}
    const buffer=await readFile(outputPath);
    const {durationSeconds}=inspectAudioMetadata(buffer,'wav');
    if(durationSeconds>600)throw Object.assign(new Error('每次录音最长支持 10 分钟'),{status:413});
    return {buffer,durationSeconds,mimeType:'audio/wav',format:'wav'};
  } finally {await rm(directory,{recursive:true,force:true});}
}
