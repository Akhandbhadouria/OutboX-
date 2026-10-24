import IORedis from 'ioredis';

const CLAIM_SEND_SLOT_LUA = `
local key = KEYS[1]
local ttl = tonumber(ARGV[1])
local value = ARGV[2]
local result = redis.call('SET', key, value, 'NX', 'PX', ttl)
if result == 'OK' then
  return 1
else
  return 0
end
`;

const INCREMENT_RATE_LIMIT_LUA = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local current = redis.call('GET', key)
if current and tonumber(current) >= limit then
  return tonumber(current)
end
local newval = redis.call('INCR', key)
if newval == 1 then
  redis.call('EXPIRE', key, ttl)
end
return newval
`;

const SLACK_NOTIF_DEDUP_LUA = `
local key = KEYS[1]
local ttl = tonumber(ARGV[1])
local result = redis.call('SET', key, '1', 'NX', 'EX', ttl)
if result == 'OK' then
  return 1
else
  return 0
end
`;

export function getHourKey(): string {
  return new Date().toISOString().slice(0, 13);
}

export function getNextHourMs(): number {
  const now = Date.now();
  const msIntoHour = now % 3_600_000;
  return 3_600_000 - msIntoHour + 1000;
}

export async function claimSendSlot(
  redis: IORedis,
  senderId: string,
  minIntervalMs: number
): Promise<boolean> {
  const key = `sendslot:${senderId}`;
  const workerValue = `worker-${process.pid}-${Date.now()}`;

  try {
    const result = await (redis as unknown as IORedis & {
      claimSendSlot: (numkeys: number, ...args: string[]) => Promise<number>;
    }).claimSendSlot(1, key, String(minIntervalMs), workerValue);
    return result === 1;
  } catch (err) {
    throw new Error(`Redis unavailable for send slot claim: ${(err as Error).message}`);
  }
}

export async function reserveHourlySlot(
  redis: IORedis,
  senderId: string,
  maxPerHour: number
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const hourKey = getHourKey();
  const rateLimitKey = `ratelimit:${senderId}:${hourKey}`;
  const ttl = 3601;

  try {
    const current = await (redis as unknown as IORedis & {
      incrementRateLimit: (numkeys: number, ...args: string[]) => Promise<number>;
    }).incrementRateLimit(1, rateLimitKey, String(maxPerHour), String(ttl));

    if (current > maxPerHour) {
      return { allowed: false, retryAfterMs: getNextHourMs() };
    }
    return { allowed: true, retryAfterMs: 0 };
  } catch (err) {
    throw new Error(`Redis unavailable for rate limit: ${(err as Error).message}`);
  }
}

export async function checkSlackNotifDedup(
  redis: IORedis,
  senderId: string
): Promise<boolean> {
  const hourKey = getHourKey();
  const key = `slacknotif:${senderId}:${hourKey}`;

  try {
    const result = await (redis as unknown as IORedis & {
      slackNotifDedup: (numkeys: number, ...args: string[]) => Promise<number>;
    }).slackNotifDedup(1, key, '3601');
    return result === 1;
  } catch (err) {
    return false;
  }
}

export function loadRateLimitScripts(redis: IORedis): void {
  (redis as unknown as Record<string, unknown>)['claimSendSlot'] = undefined;
  (redis as unknown as Record<string, unknown>)['incrementRateLimit'] = undefined;
  (redis as unknown as Record<string, unknown>)['slackNotifDedup'] = undefined;

  redis.defineCommand('claimSendSlot', {
    numberOfKeys: 1,
    lua: CLAIM_SEND_SLOT_LUA,
  });

  redis.defineCommand('incrementRateLimit', {
    numberOfKeys: 1,
    lua: INCREMENT_RATE_LIMIT_LUA,
  });

  redis.defineCommand('slackNotifDedup', {
    numberOfKeys: 1,
    lua: SLACK_NOTIF_DEDUP_LUA,
  });
}
