const TTL_MS = 60 * 60 * 1000; // 1 hour — live portal responses don't change fast enough to need less.

const store = new Map();

export async function cached(key, compute) {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const value = await compute();
  store.set(key, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}
