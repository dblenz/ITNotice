import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canSendNotification, validateNotificationDraft } from './notifications.js';

describe('validateNotificationDraft', () => {
  it('requires the core fields before a draft can be considered valid', () => {
    const result = validateNotificationDraft({
      type: 'incident',
      approvalState: 'draft',
    });

    assert.equal(result.valid, false);
    assert.deepEqual(result.errors, [
      'Title is required.',
      'Summary is required.',
      'Details are required.',
      'Audience is required.',
      'Creator is required.',
    ]);
  });

  it('accepts a complete approved notification as sendable', () => {
    const draft = {
      id: 'n-1002',
      title: 'Database maintenance',
      type: 'maintenance' as const,
      audience: {
        id: 'eng',
        name: 'Engineering',
        type: 'department' as const,
      },
      summary: 'Database maintenance window for engineering systems.',
      details: 'The database team will switch over to the standby cluster at 02:00 UTC.',
      requiredFieldsComplete: true,
      approvalState: 'approved' as const,
      createdBy: 'alice',
    };

    const validation = validateNotificationDraft(draft);
    assert.equal(validation.valid, true);
    assert.equal(canSendNotification(draft), true);
  });

  it('blocks sending until the notification has been approved', () => {
    const draft = {
      id: 'n-1003',
      title: 'VPN change',
      type: 'change' as const,
      audience: {
        id: 'remote',
        name: 'Remote Employees',
        type: 'location' as const,
      },
      summary: 'VPN client update required for remote staff.',
      details: 'The VPN client will be upgraded after business hours.',
      requiredFieldsComplete: true,
      approvalState: 'submitted' as const,
      createdBy: 'bob',
    };

    assert.equal(canSendNotification(draft), false);
  });
});
