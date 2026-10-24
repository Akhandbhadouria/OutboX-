import IORedis from 'ioredis';

/**
 * Distributed rate limiting and minimum-send-interval enforcement using Redis Lua scripts.
 *
 * DESIGN:
 * - Rate limit: Per-sender, per UTC-hour window. Key: ratelimit:{senderId}:{hourKey}
 *   Uses INCR + EXPIRE for atomic reservation.
 * - Min interval: Per-sender slot reservation. Key: sendslot:{senderId}
 *   Uses SET NX PX (atomic) so only one worker can claim the slot at a time.
 *   If the slot is taken, the job is rescheduled to the next eligible time.
 *
 * POLICY:
 * - Limit is based on reservations (not successful sends) to prevent races.
 * - Global minimum interval is enforced per-sender across all workers.
 * - If Redis is unavailable, we fail-safe by NOT allowing the send (conservative).
 */

// ─── Lua scripts ────────────────────────────────────────────────────────────────

/**
 * Atomically reserve a send slot (minimum interval enforcement).
 * Returns 1 if slot claimed, 0 if already taken.
 *
 * KEYS[1] = slot key (e.g., sendslot:{senderId})
 * ARGV[1] = TTL in milliseconds (MIN_SEND_INTERVAL_MS)
 * ARGV[2] = worker identity value
 */
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

/**
 * Atomically increment hourly counter and set TTL on first use.
 * Returns current count after increment.
 *
 * KEYS[1] = rate-limit key (e.g., ratelimit:{senderId}:{hourKey})
 * ARGV[1] = max allowed per hour
 * ARGV[2] = TTL in seconds (3601 to cover the full hour + buffer)
 */
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

/**
 * Deduplicate Slack notifications.
 * Returns 1 if this is the first notification for this sender+hour, 0 if already sent.
 *
 * KEYS[1] = dedup key (e.g., slacknotif:{senderId}:{hourKey})
 * ARGV[1] = TTL in seconds
 */
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
  // UTC hour window: YYYY-MM-DDTHH
  return new Date().toISOString().slice(0, 13);
}

export function getNextHourMs(): number {
  const now = Date.now();
  const msIntoHour = now % 3_600_000;
  return 3_600_000 - msIntoHour + 1000; // Extra 1s buffer
}

/**
 * Try to claim the minimum send interval slot for a sender.
 * Returns true if claimed (can send now), false if must wait.
 */
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
    // Redis unavailable — fail-safe: do NOT allow send
    throw new Error(`Redis unavailable for send slot claim: ${(err as Error).message}`);
  }
}

/**
 * Try to reserve a spot in the hourly rate limit bucket.
 * Returns { allowed: true } if under the limit,
 *         { allowed: false, retryAfterMs } if limit is hit.
 */
export async function reserveHourlySlot(
  redis: IORedis,
  senderId: string,
  maxPerHour: number
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const hourKey = getHourKey();
  const rateLimitKey = `ratelimit:${senderId}:${hourKey}`;
  const ttl = 3601; // Slightly over 1 hour to prevent premature expiry

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

/**
 * Check and set the Slack notification dedup key.
 * Returns true if notification should be sent (first time this hour).
 */
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
    // Non-critical — just skip the notification
    return false;
  }
}

/**
 * Load all Lua scripts onto the Redis client using defineCommand.
 */
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
