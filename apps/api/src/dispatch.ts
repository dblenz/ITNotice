import PgBoss from 'pg-boss';
import type { ChannelKey } from '@itnotice/shared';
import { databaseUrl } from './db.js';
import { getAdapterForChannel, type DeliveryRequest, type DeliveryResult } from './providers.js';
import {
  getNotification,
  getRecipientsForAudience,
  logDelivery,
  markNotificationSent,
} from './store.js';

const FANOUT_QUEUE = 'notification-fanout';
const DELIVERY_QUEUE = 'notification-delivery';

let boss: PgBoss | null = null;

export async function startDispatcher(): Promise<void> {
  boss = new PgBoss(databaseUrl);
  boss.on('error', (error) => console.error('[dispatch] queue error', error));
  await boss.start();
  await boss.createQueue(FANOUT_QUEUE);
  await boss.createQueue(DELIVERY_QUEUE);

  await boss.work(FANOUT_QUEUE, async ([job]: PgBoss.Job<{ notificationId: string }>[]) => {
    await fanOut(job.data.notificationId);
  });

  await boss.work(
    DELIVERY_QUEUE,
    { batchSize: 1 },
    async ([job]: PgBoss.Job<DeliveryJob>[]) => {
      const result = await deliver(job.data);
      if (!result.ok) {
        // Throwing triggers pg-boss retry with backoff.
        throw new Error(result.error || 'Delivery failed.');
      }
    },
  );

  console.log('[dispatch] worker started');
}

export async function stopDispatcher(): Promise<void> {
  await boss?.stop();
  boss = null;
}

interface DeliveryJob {
  notificationId: string;
  employeeId?: string;
  channel: ChannelKey;
  to: string;
  subject: string;
  body: string;
  audienceName?: string;
}

/** Queue a notification for fan-out, immediately or at its scheduled time. */
export async function enqueueNotification(notificationId: string, scheduledFor?: string): Promise<void> {
  if (!boss) throw new Error('Dispatcher not started.');
  const options: PgBoss.SendOptions = { retryLimit: 3, retryDelay: 30, retryBackoff: true };
  if (scheduledFor) options.startAfter = new Date(scheduledFor);
  await boss.send(FANOUT_QUEUE, { notificationId }, options);
}

const channelAddress: Record<string, (recipient: { email?: string; phone?: string; username: string }) => string | null> = {
  web: (recipient) => recipient.username,
  email: (recipient) => recipient.email || null,
  sms: (recipient) => recipient.phone || null,
  // Chat channels post to a shared webhook/room rather than per-user targets.
  slack: () => 'channel',
  teams: () => 'channel',
  webex: () => 'room',
};

async function fanOut(notificationId: string): Promise<void> {
  if (!boss) return;
  const notification = await getNotification(notificationId);
  if (!notification) return;
  if (notification.approvalState !== 'approved' && notification.approvalState !== 'scheduled') return;

  const channels = (notification.channels || ['Web']).map((channel) => channel.toLowerCase()) as ChannelKey[];
  const recipients = await getRecipientsForAudience(notification.audience.id);
  const subject = `[${notification.type.toUpperCase()}] ${notification.title}`;
  const body = `${notification.summary}\n\n${notification.details}`;

  for (const channel of channels) {
    if (channel === 'slack' || channel === 'teams' || channel === 'webex') {
      // One post per channel destination.
      await boss.send(
        DELIVERY_QUEUE,
        {
          notificationId,
          channel,
          to: channelAddress[channel]({ username: '' }) || 'channel',
          subject,
          body,
          audienceName: notification.audience.name,
        } satisfies DeliveryJob,
        { retryLimit: 3, retryDelay: 30, retryBackoff: true },
      );
      continue;
    }

    for (const recipient of recipients) {
      const to = channelAddress[channel]?.({
        email: recipient.email,
        phone: recipient.phone,
        username: recipient.username,
      });
      if (!to) {
        await logDelivery({
          notificationId,
          employeeId: recipient.id,
          channel,
          provider: 'n/a',
          status: 'failed',
          error: `No ${channel} address for recipient.`,
        });
        continue;
      }

      await boss.send(
        DELIVERY_QUEUE,
        { notificationId, employeeId: recipient.id, channel, to, subject, body } satisfies DeliveryJob,
        { retryLimit: 3, retryDelay: 30, retryBackoff: true },
      );
    }
  }

  await markNotificationSent(notificationId);
}

async function deliver(job: DeliveryJob): Promise<DeliveryResult> {
  const adapter = await getAdapterForChannel(job.channel);
  if (!adapter) {
    const result: DeliveryResult = {
      ok: false,
      provider: 'unconfigured',
      channel: job.channel,
      error: `Channel ${job.channel} is not configured.`,
    };
    await logDelivery({
      notificationId: job.notificationId,
      employeeId: job.employeeId,
      channel: job.channel,
      provider: result.provider,
      status: 'failed',
      error: result.error,
    });
    return result;
  }

  const result = await adapter.send({
    channel: job.channel,
    to: job.to,
    subject: job.subject,
    body: job.body,
    audienceName: job.audienceName,
  } satisfies DeliveryRequest);

  await logDelivery({
    notificationId: job.notificationId,
    employeeId: job.employeeId,
    channel: job.channel,
    provider: result.provider,
    status: result.ok ? 'sent' : 'failed',
    messageId: result.messageId,
    error: result.error,
  });

  return result;
}

/** One-off direct dispatch (used by the /api/dispatch test endpoint). */
export async function dispatchNotification(
  channel: ChannelKey,
  request: Omit<DeliveryRequest, 'channel'>,
): Promise<DeliveryResult> {
  const adapter = await getAdapterForChannel(channel);
  if (!adapter) {
    return { ok: false, provider: 'unconfigured', channel, error: `Channel ${channel} is not configured.` };
  }
  return adapter.send({ ...request, channel });
}
