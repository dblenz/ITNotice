import pg from 'pg';

const { Pool } = pg;

export const databaseUrl =
  process.env.DATABASE_URL || 'postgres://itnotice:itnotice@localhost:5432/itnotice';

export const pool = new Pool({ connectionString: databaseUrl });

const migrations: Array<{ id: string; sql: string }> = [
  {
    id: '001_initial',
    sql: `
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        type TEXT NOT NULL,
        audience_id TEXT NOT NULL,
        audience_name TEXT NOT NULL,
        audience_type TEXT NOT NULL,
        summary TEXT NOT NULL,
        details TEXT NOT NULL,
        required_fields_complete BOOLEAN NOT NULL DEFAULT FALSE,
        approval_state TEXT NOT NULL DEFAULT 'submitted',
        scheduled_for TIMESTAMPTZ,
        created_by TEXT NOT NULL,
        channels JSONB NOT NULL DEFAULT '[]',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        approved_at TIMESTAMPTZ,
        sent_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS provider_config (
        channel TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        credentials TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS audiences (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'department',
        synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS employees (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        display_name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS employee_audiences (
        employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        audience_id TEXT NOT NULL REFERENCES audiences(id) ON DELETE CASCADE,
        PRIMARY KEY (employee_id, audience_id)
      );

      CREATE TABLE IF NOT EXISTS subscriptions (
        employee_id TEXT NOT NULL,
        audience_id TEXT NOT NULL,
        subscribed BOOLEAN NOT NULL DEFAULT TRUE,
        PRIMARY KEY (employee_id, audience_id)
      );

      CREATE TABLE IF NOT EXISTS delivery_log (
        id BIGSERIAL PRIMARY KEY,
        notification_id TEXT NOT NULL,
        employee_id TEXT,
        channel TEXT NOT NULL,
        provider TEXT NOT NULL,
        status TEXT NOT NULL,
        message_id TEXT,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS delivery_log_notification_idx ON delivery_log (notification_id);
    `,
  },
];

const providerDefaults: Array<{ channel: string; provider: string; status: string }> = [
  { channel: 'web', provider: 'builtin', status: 'builtin' },
  { channel: 'email', provider: 'smtp', status: 'pending' },
  { channel: 'teams', provider: 'microsoft-graph', status: 'pending' },
  { channel: 'slack', provider: 'slack-webhook', status: 'pending' },
  { channel: 'sms', provider: 'twilio', status: 'pending' },
  { channel: 'webex', provider: 'webex', status: 'pending' },
];

export async function migrate(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  for (const migration of migrations) {
    const { rowCount } = await pool.query('SELECT 1 FROM schema_migrations WHERE id = $1', [
      migration.id,
    ]);
    if (rowCount) continue;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  for (const item of providerDefaults) {
    await pool.query(
      `INSERT INTO provider_config (channel, provider, status)
       VALUES ($1, $2, $3)
       ON CONFLICT (channel) DO NOTHING`,
      [item.channel, item.provider, item.status],
    );
  }
}
