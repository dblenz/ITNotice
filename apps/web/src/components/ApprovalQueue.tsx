import { useState } from 'react';
import type { NotificationDraft } from '@itnotice/shared';
import { api } from '../api';

type DeliverySummary = Record<string, { sent: number; failed: number; queued: number }>;

interface Props {
  notifications: Array<NotificationDraft & { channels?: string[] }>;
  deliverySummary: DeliverySummary;
  canApprove: boolean;
  onChanged: () => void;
}

interface DeliveryRow {
  id: number;
  channel: string;
  provider: string;
  status: string;
  employeeName?: string;
  error?: string;
  createdAt: string;
}

export default function ApprovalQueue({ notifications, deliverySummary, canApprove, onChanged }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);

  const pending = notifications.filter((notification) => notification.approvalState === 'submitted');
  const processed = notifications.filter((notification) => notification.approvalState !== 'submitted');

  async function handleApproval(id: string, approved: boolean) {
    const { ok } = await api(`/api/notifications/${id}/${approved ? 'approve' : 'reject'}`, { method: 'POST' });
    if (ok) onChanged();
  }

  async function toggleDeliveries(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    const { data } = await api(`/api/notifications/${id}/deliveries`);
    setDeliveries(data.deliveries || []);
    setExpandedId(id);
  }

  return (
    <>
      <section className="panel">
        <h2>Approval queue</h2>
        {pending.length === 0 ? <p className="helper-copy">No notifications waiting for approval.</p> : null}
        <ul className="notice-list">
          {pending.map((notification) => (
            <li key={notification.id} className="approval-item">
              <div>
                <h3>{notification.title}</h3>
                <p>
                  {notification.audience.name} • {notification.type} • {(notification.channels || []).join(', ')}
                </p>
              </div>
              {canApprove ? (
                <div className="approval-actions">
                  <button type="button" className="approve-button" onClick={() => void handleApproval(notification.id, true)}>
                    Approve
                  </button>
                  <button type="button" className="reject-button" onClick={() => void handleApproval(notification.id, false)}>
                    Reject
                  </button>
                </div>
              ) : (
                <span className="status pending">Awaiting approver</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>Delivery status</h2>
        <ul className="notice-list">
          {processed.map((notification) => {
            const summary = deliverySummary[notification.id];
            return (
              <li key={notification.id}>
                <div>
                  <h3>{notification.title}</h3>
                  <p>
                    {notification.audience.name} • {notification.approvalState}
                    {summary
                      ? ` • ${summary.sent || 0} sent, ${summary.failed || 0} failed, ${summary.queued || 0} queued`
                      : ''}
                  </p>
                  <button type="button" className="channel-toggle" onClick={() => void toggleDeliveries(notification.id)}>
                    {expandedId === notification.id ? 'Hide log' : 'View log'}
                  </button>
                  {expandedId === notification.id ? (
                    <ul className="delivery-log">
                      {deliveries.length === 0 ? <li>No delivery records yet.</li> : null}
                      {deliveries.map((delivery) => (
                        <li key={delivery.id}>
                          <span className={`status ${delivery.status === 'sent' ? 'approved' : 'pending'}`}>
                            {delivery.status}
                          </span>{' '}
                          {delivery.channel} via {delivery.provider}
                          {delivery.employeeName ? ` → ${delivery.employeeName}` : ''}
                          {delivery.error ? ` — ${delivery.error}` : ''}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
