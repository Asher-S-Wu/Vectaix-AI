import test from 'node:test';
import assert from 'node:assert/strict';
import {rcloneRelease,verifyRcloneArchive} from '../lib/server/integrations/rclone.mjs';
test('runtime installer selects only fixed official release artifacts',()=>{
 const linux=rcloneRelease('linux','x64');assert.equal(linux.url,'https://downloads.rclone.org/v1.74.3/rclone-v1.74.3-linux-amd64.zip');assert.match(linux.sha256,/^[a-f0-9]{64}$/);
 assert.throws(()=>rcloneRelease('freebsd','arm'));
});
test('runtime installer rejects altered download bytes',()=>{assert.throws(()=>verifyRcloneArchive(Buffer.from('tampered'),rcloneRelease('linux','x64')),/校验/);});
