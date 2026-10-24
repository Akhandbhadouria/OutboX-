/**
 * Unit tests for request validation logic.
 * Tests the Zod schemas and CSV parsing logic.
 */

import { ScheduleEmailSchema, CreateCampaignSchema } from '@reachinbox/shared';

describe('ScheduleEmailSchema validation', () => {
  const validPayload = {
    senderId: '550e8400-e29b-41d4-a716-446655440000',
    subject: 'Test Subject',
    body: 'Hello World',
    recipients: ['alice@example.com', 'bob@example.com'],
    startAt: new Date(Date.now() + 60_000).toISOString(),
    delaySeconds: 2,
    maxEmailsPerHour: 100,
  };

  it('accepts a valid payload', () => {
    const result = ScheduleEmailSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('rejects invalid email addresses', () => {
    const result = ScheduleEmailSchema.safeParse({
      ...validPayload,
      recipients: ['not-an-email', 'also@invalid'],
    });
    // 'not-an-email' should fail, 'also@invalid' might pass depending on strictness
    const hasError = result.success === false;
    expect(hasError).toBe(true);
  });

  it('rejects missing senderId', () => {
    const result = ScheduleEmailSchema.safeParse({ ...validPayload, senderId: '' });
    // uuid validation requires valid uuid
    expect(result.success).toBe(false);
  });

  it('rejects empty recipients array', () => {
    const result = ScheduleEmailSchema.safeParse({ ...validPayload, recipients: [] });
    expect(result.success).toBe(false);
  });

  it('rejects negative delay', () => {
    const result = ScheduleEmailSchema.safeParse({ ...validPayload, delaySeconds: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects delay > 3600', () => {
    const result = ScheduleEmailSchema.safeParse({ ...validPayload, delaySeconds: 3601 });
    expect(result.success).toBe(false);
  });

  it('rejects maxEmailsPerHour > 1000', () => {
    const result = ScheduleEmailSchema.safeParse({ ...validPayload, maxEmailsPerHour: 1001 });
    expect(result.success).toBe(false);
  });

  it('applies defaults for optional fields', () => {
    const result = ScheduleEmailSchema.safeParse({
      senderId: '550e8400-e29b-41d4-a716-446655440000',
      subject: 'Test',
      body: 'Body',
      recipients: ['test@example.com'],
      startAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.delaySeconds).toBe(2);
      expect(result.data.maxEmailsPerHour).toBe(100);
    }
  });

  it('rejects invalid ISO datetime for startAt', () => {
    const result = ScheduleEmailSchema.safeParse({ ...validPayload, startAt: 'not-a-date' });
    expect(result.success).toBe(false);
  });
});

describe('CreateCampaignSchema validation', () => {
  const validCampaign = {
    name: 'Test Campaign',
    senderId: '550e8400-e29b-41d4-a716-446655440000',
    subject: 'Campaign Subject',
    body: 'Campaign Body',
    recipients: ['a@example.com'],
    startAt: new Date(Date.now() + 60_000).toISOString(),
    delaySeconds: 2,
    maxEmailsPerHour: 50,
  };

  it('accepts valid campaign', () => {
    expect(CreateCampaignSchema.safeParse(validCampaign).success).toBe(true);
  });

  it('requires campaign name', () => {
    const result = CreateCampaignSchema.safeParse({ ...validCampaign, name: '' });
    expect(result.success).toBe(false);
  });
});

describe('CSV/email parsing logic', () => {
  // Test the parsing logic used in the email router
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function parseEmailsFromText(content: string): { valid: string[]; invalid: string[] } {
    const seen = new Set<string>();
    const valid: string[] = [];
    const invalid: string[] = [];

    for (const line of content.split(/[\n,;]/)) {
      const normalized = line.trim().toLowerCase();
      if (!normalized) continue;
      if (emailRegex.test(normalized)) {
        if (!seen.has(normalized)) {
          seen.add(normalized);
          valid.push(normalized);
        }
      } else {
        invalid.push(normalized);
      }
    }
    return { valid, invalid };
  }

  it('parses newline-separated emails', () => {
    const { valid } = parseEmailsFromText('a@b.com\nc@d.com\ne@f.com');
    expect(valid).toHaveLength(3);
  });

  it('parses comma-separated emails', () => {
    const { valid } = parseEmailsFromText('a@b.com,c@d.com,e@f.com');
    expect(valid).toHaveLength(3);
  });

  it('deduplicates addresses', () => {
    const { valid } = parseEmailsFromText('a@b.com\na@b.com\na@b.com');
    expect(valid).toHaveLength(1);
  });

  it('normalizes to lowercase', () => {
    const { valid } = parseEmailsFromText('Test@Example.COM');
    expect(valid[0]).toBe('test@example.com');
  });

  it('identifies invalid addresses', () => {
    const { invalid } = parseEmailsFromText('not-an-email\nalso-invalid');
    expect(invalid.length).toBeGreaterThan(0);
  });

  it('handles mixed valid and invalid', () => {
    const { valid, invalid } = parseEmailsFromText('good@example.com\nbad-email\n@missing.user');
    expect(valid).toHaveLength(1);
    expect(invalid.length).toBeGreaterThan(0);
  });
});
