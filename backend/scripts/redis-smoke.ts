/**
 * Connectivity smoke test: proves the app's own Redis config (src/lib/redis.ts,
 * driven by .env) reaches the container on the remapped host port.
 * Run: npx tsx scripts/redis-smoke.ts
 */
import { createRedisConnection, baseRedisOptions } from '../src/lib/redis.js';

const key = `smoke:${Date.now()}`;
const value = 'reachinbox-ok';
const redis = createRedisConnection();

try {
  console.log(`connecting to ${baseRedisOptions.host}:${baseRedisOptions.port}`);
  console.log('PING     ->', await redis.ping());
  console.log('SET      ->', await redis.set(key, value));

  const read = await redis.get(key);
  console.log('GET      ->', read);
  if (read !== value) throw new Error(`GET mismatch: expected ${value}, got ${read}`);

  console.log('DEL      ->', await redis.del(key));
  console.log('GET after DEL ->', await redis.get(key));

  const [, appendonly] = (await redis.config('GET', 'appendonly')) as string[];
  console.log('appendonly ->', appendonly);

  console.log('\nRESULT: PASS');
} catch (err) {
  console.error('\nRESULT: FAIL —', err);
  process.exitCode = 1;
} finally {
  await redis.quit();
}
