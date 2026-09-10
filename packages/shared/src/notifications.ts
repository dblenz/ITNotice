import type { ApprovalState, AudienceGroup, NotificationDraft, NotificationType } from './index.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface NotificationDraftInput {
  id?: string;
  title?: string;
  type?: NotificationType;
  audience?: AudienceGroup | null;
  summary?: string;
  details?: string;
  requiredFieldsComplete?: boolean;
  approvalState?: ApprovalState;
  scheduledFor?: string;
  createdBy?: string;
}

export function validateNotificationDraft(input: NotificationDraftInput): ValidationResult {
  const errors: string[] = [];

  if (!input.title || !input.title.trim()) errors.push('Title is required.');
  if (!input.summary || !input.summary.trim()) errors.push('Summary is required.');
  if (!input.details || !input.details.trim()) errors.push('Details are required.');
  if (!input.audience || !input.audience.id || !input.audience.name) {
    errors.push('Audience is required.');
  }
  if (!input.type) errors.push('Notification type is required.');
  if (!input.createdBy || !input.createdBy.trim()) errors.push('Creator is required.');

  if (input.requiredFieldsComplete === false) {
    errors.push('All required fields must be complete before submission.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function canSendNotification(draft: Partial<NotificationDraft>): boolean {
  if (!draft || !draft.type || !draft.audience || !draft.title || !draft.summary || !draft.details) {
    return false;
  }

  if (draft.requiredFieldsComplete !== true) {
    return false;
  }

  return draft.approvalState === 'approved' || draft.approvalState === 'scheduled';
}
