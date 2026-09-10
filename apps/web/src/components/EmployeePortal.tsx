import { useEffect, useState } from 'react';
import { api } from '../api';

interface StatusItem {
  id: string;
  title: string;
  type: string;
  summary: string;
  audience: string;
  approvedAt: string | null;
}

interface SubscriptionItem {
  id: string;
  name: string;
  type: string;
  subscribed: boolean;
  is_member: boolean;
}

export default function EmployeePortal() {
  const [statusItems, setStatusItems] = useState<StatusItem[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionItem[]>([]);

  const load = async () => {
    const [status, subs] = await Promise.all([api('/api/employee/status'), api('/api/me/subscriptions')]);
    setStatusItems(status.data.statusPage || []);
    setSubscriptions(subs.data.subscriptions || []);
  };

  useEffect(() => {
    void load();
  }, []);

  async function toggleSubscription(audienceId: string, subscribed: boolean) {
    await api(`/api/me/subscriptions/${audienceId}`, { method: 'PUT', body: { subscribed } });
    void load();
  }

  return (
    <section className="content-grid employee-view">
      <div className="panel">
        <h2>Current IT status</h2>
        {statusItems.length === 0 ? <p className="helper-copy">No active notices right now.</p> : null}
        <ul className="notice-list">
          {statusItems.map((item) => (
            <li key={item.id}>
              <div>
                <h3>{item.title}</h3>
                <p>
                  {item.audience} • {item.type}
                  {item.approvedAt ? ` • ${new Date(item.approvedAt).toLocaleString()}` : ''}
                </p>
                <small>{item.summary}</small>
              </div>
              <span className="status approved">Live</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="panel">
        <h2>My subscriptions</h2>
        {subscriptions.length === 0 ? (
          <p className="helper-copy">No audiences found yet. Ask an admin to run a directory sync.</p>
        ) : null}
        <div className="subscription-list">
          {subscriptions.map((subscription) => (
            <div key={subscription.id} className="subscription-item">
              <span>
                {subscription.name}
                {subscription.is_member ? '' : ' (not a member)'}
              </span>
              <input
                type="checkbox"
                checked={subscription.subscribed}
                onChange={(e) => void toggleSubscription(subscription.id, e.target.checked)}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
