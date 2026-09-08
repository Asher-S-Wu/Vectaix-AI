// Single-instance project mutations share this gate, including route bundles.
const locks = globalThis.__vectaixProjectMutations ??= new Map();
export async function withProjectLock(userId, projectId, operation) {
  const key = `${userId}:${projectId}`;
  const previous = locks.get(key) ?? Promise.resolve();
  let release;
  const turn = new Promise(resolve => { release = resolve; });
  locks.set(key, turn);
  await previous;
  try { return await operation(); }
  finally { release(); if (locks.get(key) === turn) locks.delete(key); }
}
