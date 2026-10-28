import { createHash } from 'node:crypto';

const avatars = ['cat', 'rabbit', 'bear', 'fox', 'panda', 'koala', 'penguin', 'bird'];

export function getDefaultAvatarUrl(userId) {
  // Derive a stable random assignment from the account ID, including existing accounts.
  const hash = createHash('sha256').update(String(userId)).digest();
  return `/avatars/${avatars[hash.readUInt32BE(0) % avatars.length]}.svg`;
}
