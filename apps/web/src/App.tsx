import { useCallback, useEffect, useState } from 'react';
import type { NotificationDraft } from '@itnotice/shared';
import { api } from './api';
import { config } from './config';
import { useSession } from './session';
import NotificationForm from './components/NotificationForm';
import ApprovalQueue from './components/ApprovalQueue';
import ChannelConfig, { type ChannelInfo, type CredentialFields } from './components/ChannelConfig';
import EmployeePortal from './components/EmployeePortal';

type Tab = 'admin' | 'employee';

export default function App() {
  const session = useSession();
  const isAdmin = session.roles.includes('admin');
  const isApprover = isAdmin || session.roles.includes('approver');
  const isAuthor = isAdmin || session.roles.includes('author');
  const canSeeAdminTab = isAdmin || isApprover || isAuthor;

  const [tab, setTab] = useState<Tab>(canSeeAdminTab ? 'admin' : 'employee');
  const [notifications, setNotifications] = useState<Array<NotificationDraft & { channels?: string[] }>>([]);
  const [deliverySummary, setDeliverySummary] = useState<Record<string, { sent: number; failed: number; queued: number }>>({});
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [credentialFields, setCredentialFields] = useState<CredentialFields>({});
  const [audiences, setAudiences] = useState<Array<{ id: string; name: string; type: string }>>([]);
  const [syncMessage, setSyncMessage] = useState('');

  const loadAll = useCallback(async () => {
    const requests: Array<Promise<void>> = [
      api('/api/channels').then(({ data }) => {
        setChannels(data.channels || []);
        setCredentialFields(data.credentialFields || {});
      }),
      api('/api/audiences').then(({ data }) => setAudiences(data.audiences || [])),
    ];

    if (canSeeAdminTab) {
      requests.push(
        api('/api/notifications').then(({ data }) => {
          setNotifications(data.notifications || []);
          setDeliverySummary(data.deliverySummary || {});
        }),
      );
    }

    await Promise.all(requests);
  }, [canSeeAdminTab]);

  useEffect(() => {
    void loadAll();
  }, [session.authenticated, loadAll]);

  async function handleDirectorySync() {
    setSyncMessage('Syncing…');
    const { data } = await api('/api/directory/sync', { method: 'POST' });
    setSyncMessage(data.message || 'Sync complete.');
    void loadAll();
  }

  if (!session.ready) {
    return (
      <main className="app-shell">
        <p className="helper-copy">Loading…</p>
      </main>
    );
  }

  // Allow anonymous users to view the employee status feed without signing in.

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Internal communications</p>
          <h1>{config.appName}</h1>
        </div>
        <div className="tab-row">
          {canSeeAdminTab ? (
            <button className={tab === 'admin' ? 'tab active' : 'tab'} onClick={() => setTab('admin')} type="button">
              Admin
            </button>
          ) : null}
          <button className={tab === 'employee' ? 'tab active' : 'tab'} onClick={() => setTab('employee')} type="button">
            Employee portal
          </button>
          {session.authenticated ? (
            <button className="tab" type="button" onClick={session.logout} title={`Signed in as ${session.username}`}>
              Sign out
            </button>
          ) : (
            <button className="tab" type="button" onClick={session.login}>
              Sign in
            </button>
          )}
        </div>
      </header>

      {tab === 'admin' && canSeeAdminTab ? (
        <>
          <section className="summary-grid">
            <div className="card">
              <span>Open notifications</span>
              <strong>{notifications.length}</strong>
            </div>
            <div className="card">
              <span>Pending approval</span>
              <strong>{notifications.filter((n) => n.approvalState === 'submitted').length}</strong>
            </div>
            <div className="card">
              <span>Scheduled sends</span>
              <strong>{notifications.filter((n) => n.approvalState === 'scheduled').length}</strong>
            </div>
          </section>

          <section className="content-grid">
            {isAuthor ? (
              <NotificationForm
                audiences={audiences}
                enabledChannels={channels}
                username={session.username}
                onSaved={() => void loadAll()}
              />
            ) : (
              <div className="panel">
                <h2>Notifications</h2>
                <p className="helper-copy">You have approver access. Review the queue on the right.</p>
              </div>
            )}

            <div className="stack-panel">
              {isAdmin ? (
                <>
                  <ChannelConfig channels={channels} credentialFields={credentialFields} onChanged={() => void loadAll()} />
                  <section className="panel">
                    <h2>Directory sync</h2>
                    <p className="helper-copy">
                      Pull employees and groups from your identity provider to power audience targeting.
                    </p>
                    <button type="button" className="primary-button" onClick={() => void handleDirectorySync()}>
                      Sync now
                    </button>
                    {syncMessage ? <p className="submit-message">{syncMessage}</p> : null}
                  </section>
                </>
              ) : null}

              <ApprovalQueue
                notifications={notifications}
                deliverySummary={deliverySummary}
                canApprove={isApprover}
                onChanged={() => void loadAll()}
              />
            </div>
          </section>
        </>
      ) : (
        <EmployeePortal />
      )}
    </main>
  );
}
