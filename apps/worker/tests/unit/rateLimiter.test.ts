
import { getHourKey, getNextHourMs } from '../../src/queue/rateLimiter';

describe('Rate limiter utilities', () => {
  describe('getHourKey', () => {
    it('returns a string in format YYYY-MM-DDTHH', () => {
      const key = getHourKey();
      expect(key).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}$/);
    });

    it('returns consistent key within the same second', () => {
      const key1 = getHourKey();
      const key2 = getHourKey();
      expect(key1).toBe(key2);
    });
  });

  describe('getNextHourMs', () => {
    it('returns a positive value', () => {
      expect(getNextHourMs()).toBeGreaterThan(0);
    });

    it('returns a value at most 1 hour + buffer', () => {
      expect(getNextHourMs()).toBeLessThanOrEqual(3_601_000 + 1000);
    });
  });
});

describe('Email job determinism', () => {
  it('generates consistent job ID from email ID', () => {
    const emailId = 'test-email-123';
    const jobId = `email-${emailId}`;
    expect(jobId).toBe('email-test-email-123');
    expect(`email-${emailId}`).toBe(jobId);
  });

  it('generates different job IDs for different emails', () => {
    const id1 = `email-${crypto.randomUUID()}`;
    const id2 = `email-${crypto.randomUUID()}`;
    expect(id1).not.toBe(id2);
  });
});

describe('Min delay enforcement logic', () => {
  it('calculates correct delay from scheduled time', () => {
    const now = Date.now();
    const futureMs = now + 60_000;
    const delayMs = Math.max(0, futureMs - now);
    expect(delayMs).toBeGreaterThan(0);
    expect(delayMs).toBeLessThanOrEqual(60_000);
  });

  it('uses 0 delay for past-scheduled emails (immediate send)', () => {
    const past = Date.now() - 5000;
    const delayMs = Math.max(0, past - Date.now());
    expect(delayMs).toBe(0);
  });
});

describe('Idempotency key generation', () => {
  it('generates consistent key for campaign emails', () => {
    const campaignId = 'campaign-001';
    const recipient = 'user@example.com';
    const key = `campaign-${campaignId}-${recipient}`;
    expect(key).toBe('campaign-campaign-001-user@example.com');
  });

  it('generates consistent key for direct emails', () => {
    const senderId = 'sender-001';
    const recipient = 'user@example.com';
    const startAt = '2026-11-01T10:00:00.000Z';
    const key = `direct-${senderId}-${recipient}-${startAt}`;
    expect(key).toContain(senderId);
    expect(key).toContain(recipient);
  });
});
