import nodemailer from 'nodemailer';
import type { ChannelKey } from '@itnotice/shared';
import { getProviderConfig } from './store.js';

export type DeliveryChannel = ChannelKey;

export interface DeliveryRequest {
  channel: DeliveryChannel;
  to: string;
  subject?: string;
  body: string;
  audienceName?: string;
}

export interface DeliveryResult {
  ok: boolean;
  provider: string;
  channel: DeliveryChannel;
  messageId?: string;
  error?: string;
}

export interface DeliveryAdapter {
  provider: string;
  send(request: DeliveryRequest): Promise<DeliveryResult>;
  /** Verify the configured credentials without sending to a real recipient. */
  test(): Promise<{ ok: boolean; error?: string }>;
}

type Credentials = Record<string, string>;

/** Field definitions used by the admin UI to render credential forms. */
export const channelCredentialFields: Record<
  Exclude<ChannelKey, 'web'>,
  Array<{ key: string; label: string; secret?: boolean }>
> = {
  email: [
    { key: 'host', label: 'SMTP host' },
    { key: 'port', label: 'SMTP port' },
    { key: 'secure', label: 'Use TLS (true/false)' },
    { key: 'user', label: 'Username' },
    { key: 'pass', label: 'Password', secret: true },
    { key: 'from', label: 'From address' },
  ],
  slack: [{ key: 'webhookUrl', label: 'Incoming webhook URL', secret: true }],
  sms: [
    { key: 'accountSid', label: 'Twilio Account SID' },
    { key: 'authToken', label: 'Twilio Auth Token', secret: true },
    { key: 'from', label: 'From phone number' },
  ],
  teams: [{ key: 'webhookUrl', label: 'Teams incoming webhook URL', secret: true }],
  webex: [
    { key: 'botToken', label: 'Webex bot token', secret: true },
    { key: 'roomId', label: 'Default room ID (optional)' },
  ],
};

// ---------- adapters ----------

class WebFeedAdapter implements DeliveryAdapter {
  provider = 'builtin';
  async send(request: DeliveryRequest): Promise<DeliveryResult> {
    // The web channel is the in-app feed; publishing is handled by the status
    // endpoint, so delivery always succeeds and is recorded for auditing.
    return { ok: true, provider: this.provider, channel: 'web', messageId: `web-${Date.now()}` };
  }
  async test() {
    return { ok: true };
  }
}

class SmtpEmailAdapter implements DeliveryAdapter {
  provider = 'smtp';
  constructor(private credentials: Credentials) {}

  private transport() {
    return nodemailer.createTransport({
      host: this.credentials.host,
      port: Number(this.credentials.port || 587),
      secure: this.credentials.secure === 'true',
      auth: this.credentials.user
        ? { user: this.credentials.user, pass: this.credentials.pass }
        : undefined,
    });
  }

  async send(request: DeliveryRequest): Promise<DeliveryResult> {
    try {
      const info = await this.transport().sendMail({
        from: this.credentials.from,
        to: request.to,
        subject: request.subject || 'IT Notice',
        text: request.body,
      });
      return { ok: true, provider: this.provider, channel: 'email', messageId: info.messageId };
    } catch (error: any) {
      return { ok: false, provider: this.provider, channel: 'email', error: error?.message || 'SMTP send failed.' };
    }
  }

  async test() {
    try {
      await this.transport().verify();
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: error?.message || 'SMTP verification failed.' };
    }
  }
}

class WebhookAdapter implements DeliveryAdapter {
  constructor(
    public provider: string,
    private channel: DeliveryChannel,
    private webhookUrl: string,
  ) {}

  async send(request: DeliveryRequest): Promise<DeliveryResult> {
    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: request.subject ? `*${request.subject}*\n${request.body}` : request.body }),
      });
      if (!response.ok) {
        return {
          ok: false,
          provider: this.provider,
          channel: this.channel,
          error: `Webhook returned ${response.status}.`,
        };
      }
      return { ok: true, provider: this.provider, channel: this.channel, messageId: `${this.provider}-${Date.now()}` };
    } catch (error: any) {
      return { ok: false, provider: this.provider, channel: this.channel, error: error?.message || 'Webhook failed.' };
    }
  }

  async test() {
    if (!/^https:\/\//.test(this.webhookUrl)) {
      return { ok: false, error: 'Webhook URL must start with https://.' };
    }
    return { ok: true };
  }
}

class TwilioSmsAdapter implements DeliveryAdapter {
  provider = 'twilio';
  constructor(private credentials: Credentials) {}

  private authHeader() {
    return `Basic ${Buffer.from(`${this.credentials.accountSid}:${this.credentials.authToken}`).toString('base64')}`;
  }

  async send(request: DeliveryRequest): Promise<DeliveryResult> {
    try {
      const params = new URLSearchParams({
        To: request.to,
        From: this.credentials.from,
        Body: request.subject ? `${request.subject}: ${request.body}` : request.body,
      });
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${this.credentials.accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: { Authorization: this.authHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        },
      );
      const data: any = await response.json().catch(() => ({}));
      if (!response.ok) {
        return { ok: false, provider: this.provider, channel: 'sms', error: data?.message || `Twilio returned ${response.status}.` };
      }
      return { ok: true, provider: this.provider, channel: 'sms', messageId: data?.sid };
    } catch (error: any) {
      return { ok: false, provider: this.provider, channel: 'sms', error: error?.message || 'Twilio send failed.' };
    }
  }

  async test() {
    try {
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${this.credentials.accountSid}.json`,
        { headers: { Authorization: this.authHeader() } },
      );
      if (!response.ok) return { ok: false, error: `Twilio credential check returned ${response.status}.` };
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: error?.message || 'Twilio credential check failed.' };
    }
  }
}

class WebexAdapter implements DeliveryAdapter {
  provider = 'webex';
  constructor(private credentials: Credentials) {}

  async send(request: DeliveryRequest): Promise<DeliveryResult> {
    try {
      const payload: Record<string, string> = {
        text: request.subject ? `${request.subject}\n${request.body}` : request.body,
      };
      if (request.to.includes('@')) payload.toPersonEmail = request.to;
      else if (this.credentials.roomId) payload.roomId = this.credentials.roomId;
      else payload.roomId = request.to;

      const response = await fetch('https://webexapis.com/v1/messages', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.credentials.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const data: any = await response.json().catch(() => ({}));
      if (!response.ok) {
        return { ok: false, provider: this.provider, channel: 'webex', error: data?.message || `Webex returned ${response.status}.` };
      }
      return { ok: true, provider: this.provider, channel: 'webex', messageId: data?.id };
    } catch (error: any) {
      return { ok: false, provider: this.provider, channel: 'webex', error: error?.message || 'Webex send failed.' };
    }
  }

  async test() {
    try {
      const response = await fetch('https://webexapis.com/v1/people/me', {
        headers: { Authorization: `Bearer ${this.credentials.botToken}` },
      });
      if (!response.ok) return { ok: false, error: `Webex token check returned ${response.status}.` };
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: error?.message || 'Webex token check failed.' };
    }
  }
}

// ---------- factory ----------

export function buildAdapter(channel: DeliveryChannel, credentials: Credentials): DeliveryAdapter {
  switch (channel) {
    case 'web':
      return new WebFeedAdapter();
    case 'email':
      return new SmtpEmailAdapter(credentials);
    case 'slack':
      return new WebhookAdapter('slack-webhook', 'slack', credentials.webhookUrl || '');
    case 'teams':
      return new WebhookAdapter('teams-webhook', 'teams', credentials.webhookUrl || '');
    case 'sms':
      return new TwilioSmsAdapter(credentials);
    case 'webex':
      return new WebexAdapter(credentials);
  }
}

/** Load credentials from the database and return a ready adapter, or null when unconfigured. */
export async function getAdapterForChannel(channel: DeliveryChannel): Promise<DeliveryAdapter | null> {
  if (channel === 'web') return new WebFeedAdapter();
  const config = await getProviderConfig(channel);
  if (!config || config.status !== 'configured' || !config.credentials) return null;
  return buildAdapter(channel, config.credentials);
}
