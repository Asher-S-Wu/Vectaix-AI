import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isBlockedMediaAddress } from '../../media/server/mediaKit/security.js';

export async function assertPublicUrl(value, { protocols = ['https:', 'http:'], ports } = {}) {
  const url = new URL(String(value));
  if (!protocols.includes(url.protocol) || url.username || url.password || (ports && url.port && !ports.map(String).includes(url.port))) {
    throw new Error('连接地址或端口不受支持');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.internal') || hostname.endsWith('.local')) {
    throw new Error('不能访问本机或内部网络');
  }
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => isBlockedMediaAddress(item.address))) throw new Error('连接地址必须解析到公开网络');
  return url;
}
