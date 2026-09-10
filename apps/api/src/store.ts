import type { ChannelInfo, ChannelKey, NotificationDraft } from '@itnotice/shared';
import { ALL_CHANNELS, CHANNEL_LABELS } from '@itnotice/shared';
import { pool } from './db.js';
import { decrypt, encrypt } from './crypto.js';

export type NotificationRecord = NotificationDraft & {
  channels?: string[];
  approvedAt?: string;
  sentAt?: string;
};

function mapNotification(row: any): NotificationRecord {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    audience: {
      id: row.audience_id,
      name: row.audience_name,
      type: row.audience_type,
    },
    summary: row.summary,
    details: row.details,
    requiredFieldsComplete: Boolean(row.required_fields_complete),
    approvalState: row.approval_state,
    scheduledFor: row.scheduled_for ? new Date(row.scheduled_for).toISOString() : undefined,
    createdBy: row.created_by,
    channels: Array.isArray(row.channels) ? row.channels : JSON.parse(row.channels || '[]'),
    approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : undefined,
    sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : undefined,
  };
}

export async function getNotifications(): Promise<NotificationRecord[]> {
  const { rows } = await pool.query('SELECT * FROM notifications ORDER BY created_at DESC');
  return rows.map(mapNotification);
}

export async function getNotification(id: string): Promise<NotificationRecord | null> {
  const { rows } = await pool.query('SELECT * FROM notifications WHERE id = $1', [id]);
  return rows[0] ? mapNotification(rows[0]) : null;
}

export async function addNotification(item: NotificationRecord): Promise<NotificationRecord> {
  await pool.query(
    `INSERT INTO notifications
       (id, title, type, audience_id, audience_name, audience_type, summary, details,
        required_fields_complete, approval_state, scheduled_for, created_by, channels)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      item.id,
      item.title,
      item.type,
      item.audience.id,
      item.audience.name,
      item.audience.type,
      item.summary,
      item.details,
      item.requiredFieldsComplete,
      item.approvalState,
      item.scheduledFor || null,
      item.createdBy,
      JSON.stringify(item.channels || ['Web']),
    ],
  );
  return item;
}

export async function updateNotificationStatus(
  id: string,
  approvalState: NotificationDraft['approvalState'],
): Promise<NotificationRecord | null> {
  const setApproved = approvalState === 'approved' || approvalState === 'scheduled';
  const { rows } = await pool.query(
    `UPDATE notifications
       SET approval_state = $2,
           approved_at = CASE WHEN $3 THEN now() ELSE approved_at END
     WHERE id = $1
     RETURNING *`,
    [id, approvalState, setApproved],
  );
  return rows[0] ? mapNotification(rows[0]) : null;
}

export async function markNotificationSent(id: string): Promise<void> {
  await pool.query(
    `UPDATE notifications SET approval_state = 'sent', sent_at = now() WHERE id = $1`,
    [id],
  );
}

// ---------- channels / provider config ----------

export interface ProviderConfigRow {
  channel: ChannelKey;
  provider: string;
  status: string;
  credentials?: Record<string, string>;
}

export async function getChannels(): Promise<ChannelInfo[]> {
  const { rows } = await pool.query('SELECT channel, provider, status FROM provider_config');
  const byChannel = new Map<string, any>(rows.map((row: any) => [row.channel, row]));

  return ALL_CHANNELS.map((channel) => {
    const row = byChannel.get(channel);
    const status = channel === 'web' ? 'builtin' : row?.status === 'configured' ? 'configured' : 'pending';
    return {
      channel,
      label: CHANNEL_LABELS[channel],
      provider: row?.provider || 'builtin',
      status,
      enabled: status === 'builtin' || status === 'configured',
    };
  });
}

export async function getProviderConfig(channel: ChannelKey): Promise<ProviderConfigRow | null> {
  const { rows } = await pool.query('SELECT * FROM provider_config WHERE channel = $1', [channel]);
  if (!rows[0]) return null;
  const row = rows[0];
  let credentials: Record<string, string> | undefined;
  if (row.credentials) {
    try {
      credentials = JSON.parse(decrypt(row.credentials));
    } catch {
      credentials = undefined;
    }
  }
  return { channel: row.channel, provider: row.provider, status: row.status, credentials };
}

export async function saveProviderConfig(
  channel: ChannelKey,
  provider: string,
  credentials: Record<string, string>,
  status: 'configured' | 'pending',
): Promise<void> {
  await pool.query(
    `INSERT INTO provider_config (channel, provider, status, credentials, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (channel)
     DO UPDATE SET provider = $2, status = $3, credentials = $4, updated_at = now()`,
    [channel, provider, status, encrypt(JSON.stringify(credentials))],
  );
}

export async function setChannelStatus(channel: ChannelKey, status: 'configured' | 'pending'): Promise<void> {
  await pool.query('UPDATE provider_config SET status = $2, updated_at = now() WHERE channel = $1', [
    channel,
    status,
  ]);
}

// ---------- audiences / employees / subscriptions ----------

export async function getAudiences() {
  const { rows } = await pool.query('SELECT id, name, type FROM audiences ORDER BY name ASC');
  return rows as Array<{ id: string; name: string; type: string }>;
}

export async function upsertAudience(id: string, name: string, type = 'department') {
  await pool.query(
    `INSERT INTO audiences (id, name, type, synced_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (id) DO UPDATE SET name = $2, type = $3, synced_at = now()`,
    [id, name, type],
  );
}

export async function upsertEmployee(employee: {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  phone?: string;
}) {
  await pool.query(
    `INSERT INTO employees (id, username, display_name, email, phone, synced_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (id) DO UPDATE
       SET username = $2, display_name = $3, email = $4, phone = $5, synced_at = now()`,
    [employee.id, employee.username, employee.displayName, employee.email || null, employee.phone || null],
  );
}

export async function setEmployeeAudiences(employeeId: string, audienceIds: string[]) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM employee_audiences WHERE employee_id = $1', [employeeId]);
    for (const audienceId of audienceIds) {
      await client.query(
        `INSERT INTO employee_audiences (employee_id, audience_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [employeeId, audienceId],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Employees in an audience who have not opted out. */
export async function getRecipientsForAudience(audienceId: string) {
  const { rows } = await pool.query(
    `SELECT e.id, e.username, e.display_name, e.email, e.phone
       FROM employees e
       JOIN employee_audiences ea ON ea.employee_id = e.id
      WHERE ea.audience_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM subscriptions s
           WHERE s.employee_id = e.id AND s.audience_id = $1 AND s.subscribed = FALSE
        )`,
    [audienceId],
  );
  return rows as Array<{ id: string; username: string; display_name: string; email?: string; phone?: string }>;
}

export async function getSubscriptions(employeeId: string) {
  const { rows } = await pool.query(
    `SELECT a.id, a.name, a.type,
            COALESCE(s.subscribed, TRUE) AS subscribed,
            (ea.employee_id IS NOT NULL) AS is_member
       FROM audiences a
       LEFT JOIN subscriptions s ON s.audience_id = a.id AND s.employee_id = $1
       LEFT JOIN employee_audiences ea ON ea.audience_id = a.id AND ea.employee_id = $1
      ORDER BY a.name ASC`,
    [employeeId],
  );
  return rows as Array<{ id: string; name: string; type: string; subscribed: boolean; is_member: boolean }>;
}

export async function setSubscription(employeeId: string, audienceId: string, subscribed: boolean) {
  await pool.query(
    `INSERT INTO subscriptions (employee_id, audience_id, subscribed) VALUES ($1, $2, $3)
     ON CONFLICT (employee_id, audience_id) DO UPDATE SET subscribed = $3`,
    [employeeId, audienceId, subscribed],
  );
}

/** Audience ids an employee is subscribed to (member + not opted out). */
export async function getSubscribedAudienceIds(employeeId: string): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT ea.audience_id
       FROM employee_audiences ea
      WHERE ea.employee_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM subscriptions s
           WHERE s.employee_id = $1 AND s.audience_id = ea.audience_id AND s.subscribed = FALSE
        )`,
    [employeeId],
  );
  return rows.map((row: any) => row.audience_id);
}

// ---------- delivery log ----------

export async function logDelivery(entry: {
  notificationId: string;
  employeeId?: string;
  channel: string;
  provider: string;
  status: 'queued' | 'sent' | 'failed';
  messageId?: string;
  error?: string;
}) {
  await pool.query(
    `INSERT INTO delivery_log (notification_id, employee_id, channel, provider, status, message_id, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.notificationId,
      entry.employeeId || null,
      entry.channel,
      entry.provider,
      entry.status,
      entry.messageId || null,
      entry.error || null,
    ],
  );
}

export async function getDeliveryLog(notificationId: string) {
  const { rows } = await pool.query(
    `SELECT dl.*, e.display_name
       FROM delivery_log dl
       LEFT JOIN employees e ON e.id = dl.employee_id
      WHERE dl.notification_id = $1
      ORDER BY dl.created_at DESC
      LIMIT 500`,
    [notificationId],
  );
  return rows.map((row: any) => ({
    id: Number(row.id),
    notificationId: row.notification_id,
    employeeId: row.employee_id || undefined,
    employeeName: row.display_name || undefined,
    channel: row.channel,
    provider: row.provider,
    status: row.status,
    messageId: row.message_id || undefined,
    error: row.error || undefined,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function getDeliverySummary() {
  const { rows } = await pool.query(
    `SELECT notification_id, status, COUNT(*)::int AS count
       FROM delivery_log
      GROUP BY notification_id, status`,
  );
  const summary: Record<string, { sent: number; failed: number; queued: number }> = {};
  for (const row of rows as Array<{ notification_id: string; status: string; count: number }>) {
    summary[row.notification_id] ||= { sent: 0, failed: 0, queued: 0 };
    const bucket = summary[row.notification_id] as Record<string, number>;
    bucket[row.status] = row.count;
  }
  return summary;
}
