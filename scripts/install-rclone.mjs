import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile,rename,access,chmod,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import yauzl from 'yauzl';
import {RCLONE_VERSION,rcloneRelease,verifyRcloneArchive} from '../lib/server/integrations/rclone.mjs';
const exec=promisify(execFile);
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));const output=path.join(root,'.bin','rclone');
async function validate(binary){const {stdout}=await exec(binary,['version'],{timeout:10000,maxBuffer:8192});if(!stdout.startsWith(`rclone v${RCLONE_VERSION}\n`))throw new Error('rclone 版本不匹配');const {stdout:flags}=await exec(binary,['help','flags'],{timeout:10000,maxBuffer:1048576});for(const flag of ['--ftp-http-proxy','--sftp-shell-type','--low-level-retries','--max-transfer'])if(!flags.includes(flag))throw new Error(`rclone 缺少所需参数 ${flag}`);}
let exists=false;try{await access(output);exists=true;}catch(error){if(error.code!=='ENOENT')throw error;}
if(exists){await validate(output);console.log(`rclone v${RCLONE_VERSION} 已就绪`);}else{
 const release=rcloneRelease();console.log(`安装 rclone v${RCLONE_VERSION}`);
 const response=await fetch(release.url,{redirect:'error',signal:AbortSignal.timeout(120000)});if(!response.ok)throw new Error(`rclone 下载失败 (${response.status})`);
 const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>104857600)throw new Error('rclone 下载文件过大');chunks.push(chunk);}
 const archive=Buffer.concat(chunks);verifyRcloneArchive(archive,release);
 const binary=await new Promise((resolve,reject)=>{yauzl.fromBuffer(archive,{lazyEntries:true},(error,zip)=>{
  if(error)return reject(error);let found=false;zip.on('error',reject);zip.on('end',()=>{if(!found)reject(new Error('下载文件中缺少 rclone 程序'));});
  zip.on('entry',entry=>{if(entry.fileName!==release.entry){zip.readEntry();return;}found=true;if(entry.uncompressedSize>314572800){zip.close();reject(new Error('rclone 程序过大'));return;}zip.openReadStream(entry,(err,stream)=>{if(err)return reject(err);const values=[];stream.on('data',chunk=>values.push(chunk));stream.on('error',reject);stream.on('end',()=>{zip.close();resolve(Buffer.concat(values));});});});zip.readEntry();
 });});
 await mkdir(path.dirname(output),{recursive:true});const temporary=output+'.tmp';
 try{await writeFile(temporary,binary,{mode:0o755,flag:'wx'});await chmod(temporary,0o755);await validate(temporary);await rename(temporary,output);}finally{await rm(temporary,{force:true});}
 console.log(`rclone v${RCLONE_VERSION} 安装并验证完成`);
}
