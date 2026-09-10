export type NotificationType = 'incident' | 'change' | 'maintenance' | 'general';
export type AudienceType = 'company' | 'location' | 'business-unit' | 'department';
export type ApprovalState = 'draft' | 'submitted' | 'approved' | 'rejected' | 'scheduled' | 'sent' | 'cancelled';

export interface AudienceGroup {
  id: string;
  name: string;
  type: AudienceType;
  description?: string;
}

export interface NotificationDraft {
  id: string;
  title: string;
  type: NotificationType;
  audience: AudienceGroup;
  summary: string;
  details: string;
  requiredFieldsComplete: boolean;
  approvalState: ApprovalState;
  scheduledFor?: string;
  createdBy: string;
}

export interface ApiHealthResponse {
  ok: boolean;
  service: string;
  timestamp: string;
}

/** Delivery channels. 'web' is built-in and always available (the in-app feed). */
export type ChannelKey = 'web' | 'email' | 'teams' | 'slack' | 'sms' | 'webex';

export const ALL_CHANNELS: ChannelKey[] = ['web', 'email', 'teams', 'slack', 'sms', 'webex'];

export const CHANNEL_LABELS: Record<ChannelKey, string> = {
  web: 'Web',
  email: 'Email',
  teams: 'Teams',
  slack: 'Slack',
  sms: 'SMS',
  webex: 'Webex',
};

export type ChannelStatus = 'builtin' | 'configured' | 'pending';

export interface ChannelInfo {
  channel: ChannelKey;
  label: string;
  provider: string;
  status: ChannelStatus;
  /** True when the channel can be selected for a notification. */
  enabled: boolean;
}

export type UserRole = 'admin' | 'approver' | 'author' | 'employee';

export interface Employee {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  phone?: string;
}

export interface Subscription {
  employeeId: string;
  audienceId: string;
}

export type DeliveryStatus = 'queued' | 'sent' | 'failed';

export interface DeliveryLogEntry {
  id: number;
  notificationId: string;
  employeeId?: string;
  channel: ChannelKey;
  provider: string;
  status: DeliveryStatus;
  messageId?: string;
  error?: string;
  createdAt: string;
}

export * from './notifications.js';
