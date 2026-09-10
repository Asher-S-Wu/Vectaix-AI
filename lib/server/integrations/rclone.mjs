import crypto from 'node:crypto';
import path from 'node:path';
export const RCLONE_VERSION='1.74.3';
const checksums={
 'linux-amd64':'dbee7ccd7a5d617e4ed4cd4555c16669b511abfe8d31164f61be35ac9e999bd2',
 'linux-arm64':'8f8d47446e061f80c3256659fe8e21f56d72d96aaefe1275d088ea5eb6b42aa7',
 'osx-amd64':'417cabd402d57806d597bd0ba8fb33a434ca8c2a1a5aa98de5a0bd4b52b39202',
 'osx-arm64':'33a435ab17023b686918ce9a3975aceb75fe1796c694f38f1993024be1f063f5',
};
export function rcloneRelease(platform=process.platform,arch=process.arch){
 const target=`${platform==='darwin'?'osx':platform}-${arch==='x64'?'amd64':arch}`;
 if(!checksums[target])throw new Error('当前系统不支持安装远端文件运行工具');
 const directory=`rclone-v${RCLONE_VERSION}-${target}`;
 return {url:`https://downloads.rclone.org/v${RCLONE_VERSION}/${directory}.zip`,sha256:checksums[target],entry:`${directory}/rclone`};
}
export function verifyRcloneArchive(buffer,release){if(crypto.createHash('sha256').update(buffer).digest('hex')!==release.sha256)throw new Error('rclone 下载文件校验失败');}
export function rcloneExecutable(){return process.env.RCLONE_PATH || path.join(process.cwd(),'.bin','rclone');}
