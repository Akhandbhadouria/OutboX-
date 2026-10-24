import { prisma } from '../../config/database';
import { getEmailQueue } from '../../queue/emailQueue';
import type { DashboardStats } from '@reachinbox/shared';

export async function getDashboardStats(userId: string): Promise<DashboardStats> {
  const [totalScheduled, totalSent, totalFailed, totalCampaigns, emailsThisHour] =
    await Promise.all([
      prisma.scheduledEmail.count({ where: { userId, status: 'scheduled' } }),
      prisma.scheduledEmail.count({ where: { userId, status: 'sent' } }),
      prisma.scheduledEmail.count({ where: { userId, status: 'failed' } }),
      prisma.emailCampaign.count({ where: { userId } }),
      prisma.scheduledEmail.count({
        where: {
          userId,
          status: 'sent',
          sentAt: {
            gte: new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000),
          },
        },
      }),
    ]);

  // Queue counts (not user-filtered, but useful for admins)
  let pendingJobs = 0;
  let activeJobs = 0;
  try {
    const queue = getEmailQueue();
    const counts = await queue.getJobCounts('waiting', 'delayed', 'active');
    pendingJobs = (counts.waiting ?? 0) + (counts.delayed ?? 0);
    activeJobs = counts.active ?? 0;
  } catch {
    // Non-critical
  }

  return {
    totalScheduled,
    totalSent,
    totalFailed,
    totalCampaigns,
    emailsThisHour,
    pendingJobs,
    activeJobs,
  };
}
