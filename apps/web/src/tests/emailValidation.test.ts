import { describe, it, expect } from 'vitest';
import { ScheduleEmailSchema, CreateCampaignSchema } from '@reachinbox/shared';

describe('Web client schema contracts', () => {
  it('validates ScheduleEmailSchema with valid inputs', () => {
    const payload = {
      senderId: '123e4567-e89b-12d3-a456-426614174000',
      recipients: ['user@example.com'],
      subject: 'Welcome to ReachInbox',
      body: '<p>Hello world</p>',
      startAt: new Date(Date.now() + 60_000).toISOString(),
      delaySeconds: 2,
      maxEmailsPerHour: 100,
    };
    const parsed = ScheduleEmailSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it('rejects invalid recipient email in Web form schema', () => {
    const payload = {
      senderId: '123e4567-e89b-12d3-a456-426614174000',
      recipients: ['not-an-email'],
      subject: 'Invalid',
      body: 'Body',
      startAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const parsed = ScheduleEmailSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it('validates CreateCampaignSchema correctly', () => {
    const campaign = {
      name: 'Spring Launch Campaign',
      senderId: '123e4567-e89b-12d3-a456-426614174000',
      subject: 'Big News!',
      body: '<p>Exciting announcement!</p>',
      recipients: ['lead1@test.com', 'lead2@test.com'],
      startAt: new Date(Date.now() + 60_000).toISOString(),
      delaySeconds: 5,
      maxEmailsPerHour: 50,
    };
    const parsed = CreateCampaignSchema.safeParse(campaign);
    expect(parsed.success).toBe(true);
  });
});
