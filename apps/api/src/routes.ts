import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { ChannelKey } from '@itnotice/shared';
import { ALL_CHANNELS, validateNotificationDraft } from '@itnotice/shared';
import { authenticate, requireRole } from './auth.js';
import { dispatchNotification, enqueueNotification } from './dispatch.js';
import { buildAdapter, channelCredentialFields } from './providers.js';
import { runDirectorySync, syncConfigured } from './sync.js';
import {
  addNotification,
  getAudiences,
  getChannels,
  getDeliveryLog,
  getDeliverySummary,
  getNotifications,
  getProviderConfig,
  getSubscribedAudienceIds,
  getSubscriptions,
  saveProviderConfig,
  setChannelStatus,
  setSubscription,
  updateNotificationStatus,
} from './store.js';

const router = Router();

function isChannelKey(value: unknown): value is ChannelKey {
  return typeof value === 'string' && (ALL_CHANNELS as string[]).includes(value);
}

router.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'api', timestamp: new Date().toISOString() });
});

// Everything below requires authentication.
router.use('/api', authenticate);

router.get('/api/me', (req, res) => {
  res.json({ user: req.user });
});

// ---------- notifications ----------

router.get('/api/notifications', requireRole('admin', 'approver', 'author'), async (_req, res, next) => {
  try {
    const [notifications, deliverySummary] = await Promise.all([getNotifications(), getDeliverySummary()]);
    res.json({ notifications, deliverySummary });
  } catch (error) {
    next(error);
  }
});

router.post('/api/notifications', requireRole('admin', 'author'), async (req, res, next) => {
  try {
    const draft = req.body;
    const validation = validateNotificationDraft(draft);
    if (!validation.valid) {
      return res.status(400).json({ message: 'Notification draft is invalid.', errors: validation.errors });
    }

    const channels: string[] =
      Array.isArray(draft.channels) && draft.channels.length > 0 ? draft.channels : ['Web'];

    const enabledChannels = new Set(
      (await getChannels()).filter((channel) => channel.enabled).map((channel) => channel.label),
    );
    const blocked = channels.filter((channel) => !enabledChannels.has(channel));
    if (blocked.length > 0) {
      return res.status(400).json({
        message: `These channels are not configured: ${blocked.join(', ')}. Ask an admin to configure them.`,
      });
    }

    const saved = {
      ...draft,
      id: draft.id || randomUUID(),
      requiredFieldsComplete: true,
      approvalState: 'submitted' as const,
      createdBy: req.user?.username || draft.createdBy,
      channels,
    };

    await addNotification(saved);
    return res.status(201).json({ message: 'Notification created and awaiting approval.', notification: saved });
  } catch (error) {
    next(error);
  }
});

router.post('/api/notifications/:id/approve', requireRole('admin', 'approver'), async (req, res, next) => {
  try {
    const scheduledFor: string | undefined = req.body?.scheduledFor;
    const target = await updateNotificationStatus(String(req.params.id), scheduledFor ? 'scheduled' : 'approved');
    if (!target) return res.status(404).json({ message: 'Notification not found.' });

    await enqueueNotification(target.id, scheduledFor || target.scheduledFor);
    return res.json({
      message: scheduledFor || target.scheduledFor ? 'Notification approved and scheduled.' : 'Notification approved and queued for delivery.',
      notification: target,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/api/notifications/:id/reject', requireRole('admin', 'approver'), async (req, res, next) => {
  try {
    const target = await updateNotificationStatus(String(req.params.id), 'rejected');
    if (!target) return res.status(404).json({ message: 'Notification not found.' });
    return res.json({ message: 'Notification rejected.', notification: target });
  } catch (error) {
    next(error);
  }
});

router.post('/api/notifications/:id/cancel', requireRole('admin', 'approver'), async (req, res, next) => {
  try {
    const target = await updateNotificationStatus(String(req.params.id), 'cancelled');
    if (!target) return res.status(404).json({ message: 'Notification not found.' });
    return res.json({ message: 'Notification cancelled.', notification: target });
  } catch (error) {
    next(error);
  }
});

router.get('/api/notifications/:id/deliveries', requireRole('admin', 'approver', 'author'), async (req, res, next) => {
  try {
    res.json({ deliveries: await getDeliveryLog(String(req.params.id)) });
  } catch (error) {
    next(error);
  }
});

// ---------- employee portal ----------

router.get('/api/employee/status', async (req, res, next) => {
  try {
    const [notifications, subscribedIds] = await Promise.all([
      getNotifications(),
      req.user ? getSubscribedAudienceIds(req.user.id) : Promise.resolve([]),
    ]);

    const visibleStates = new Set(['approved', 'scheduled', 'sent']);
    const active = notifications.filter((item) => {
      if (!visibleStates.has(item.approvalState)) return false;
      // Employees with no directory data (e.g. before first sync) see everything.
      if (subscribedIds.length === 0) return true;
      return subscribedIds.includes(item.audience.id);
    });

    res.json({
      statusPage: active.map((item) => ({
        id: item.id,
        title: item.title,
        type: item.type,
        summary: item.summary,
        audience: item.audience.name,
        approvedAt: item.approvedAt || null,
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.get('/api/me/subscriptions', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Not authenticated.' });
    res.json({ subscriptions: await getSubscriptions(req.user.id) });
  } catch (error) {
    next(error);
  }
});

router.put('/api/me/subscriptions/:audienceId', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Not authenticated.' });
    const subscribed = Boolean(req.body?.subscribed);
    await setSubscription(req.user.id, req.params.audienceId, subscribed);
    res.json({ message: 'Subscription updated.', audienceId: req.params.audienceId, subscribed });
  } catch (error) {
    next(error);
  }
});

// ---------- audiences ----------

router.get('/api/audiences', async (_req, res, next) => {
  try {
    res.json({ audiences: await getAudiences() });
  } catch (error) {
    next(error);
  }
});

// ---------- channels / provider configuration ----------

router.get('/api/channels', async (_req, res, next) => {
  try {
    res.json({ channels: await getChannels(), credentialFields: channelCredentialFields });
  } catch (error) {
    next(error);
  }
});

router.put('/api/channels/:channel/config', requireRole('admin'), async (req, res, next) => {
  try {
    const channel = req.params.channel;
    if (!isChannelKey(channel) || channel === 'web') {
      return res.status(400).json({ message: 'Unknown or built-in channel.' });
    }

    const credentials: Record<string, string> = req.body?.credentials || {};
    const adapter = buildAdapter(channel, credentials);
    const test = await adapter.test();
    if (!test.ok) {
      return res.status(400).json({ message: `Credential validation failed: ${test.error}` });
    }

    await saveProviderConfig(channel, adapter.provider, credentials, 'configured');
    return res.json({ message: 'Channel configured.', channel, status: 'configured' });
  } catch (error) {
    next(error);
  }
});

router.post('/api/channels/:channel/test', requireRole('admin'), async (req, res, next) => {
  try {
    const channel = req.params.channel;
    if (!isChannelKey(channel) || channel === 'web') {
      return res.status(400).json({ message: 'Unknown or built-in channel.' });
    }

    const credentials: Record<string, string> | undefined =
      req.body?.credentials || (await getProviderConfig(channel))?.credentials;
    if (!credentials) {
      return res.status(400).json({ message: 'No credentials to test.' });
    }

    const result = await buildAdapter(channel, credentials).test();
    return res.status(result.ok ? 200 : 400).json({
      ok: result.ok,
      message: result.ok ? 'Connection test passed.' : `Connection test failed: ${result.error}`,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/api/channels/:channel/disable', requireRole('admin'), async (req, res, next) => {
  try {
    const channel = req.params.channel;
    if (!isChannelKey(channel) || channel === 'web') {
      return res.status(400).json({ message: 'Unknown or built-in channel.' });
    }
    await setChannelStatus(channel, 'pending');
    return res.json({ message: 'Channel disabled.', channel });
  } catch (error) {
    next(error);
  }
});

// ---------- directory sync ----------

router.post('/api/directory/sync', requireRole('admin'), async (_req, res, next) => {
  try {
    if (!syncConfigured()) {
      return res.status(400).json({
        message: 'Directory sync is not configured. Set KEYCLOAK_BASE_URL and KEYCLOAK_SYNC_CLIENT_SECRET.',
      });
    }
    const result = await runDirectorySync();
    return res.json({ message: 'Directory synced.', ...result });
  } catch (error) {
    next(error);
  }
});

// ---------- ad-hoc dispatch (admin testing) ----------

router.post('/api/dispatch', requireRole('admin'), async (req, res, next) => {
  try {
    const { channel, to, subject, body } = req.body;
    if (!isChannelKey(channel) || !to || !body) {
      return res.status(400).json({ message: 'Valid channel, recipient, and body are required.' });
    }

    const result = await dispatchNotification(channel, { to, subject, body, audienceName: req.body.audienceName });
    if (!result.ok) {
      return res.status(502).json({ message: result.error || 'Delivery failed.' });
    }
    return res.json({ message: 'Message dispatched.', result });
  } catch (error) {
    next(error);
  }
});

export default router;
