import { useState } from 'react';
import { api } from '../api';

export interface ChannelInfo {
  channel: string;
  label: string;
  provider: string;
  status: string;
  enabled: boolean;
}

export type CredentialFields = Record<string, Array<{ key: string; label: string; secret?: boolean }>>;

interface Props {
  channels: ChannelInfo[];
  credentialFields: CredentialFields;
  onChanged: () => void;
}

export default function ChannelConfig({ channels, credentialFields, onChanged }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const openEditor = (channel: string) => {
    setEditing(channel);
    setForm({});
    setMessage('');
  };

  async function save(channel: string) {
    setBusy(true);
    const { ok, data } = await api(`/api/channels/${channel}/config`, {
      method: 'PUT',
      body: { credentials: form },
    });
    setBusy(false);
    setMessage(data.message || (ok ? 'Saved.' : 'Failed.'));
    if (ok) {
      setEditing(null);
      onChanged();
    }
  }

  async function test(channel: string) {
    setBusy(true);
    const { data } = await api(`/api/channels/${channel}/test`, {
      method: 'POST',
      body: Object.keys(form).length > 0 ? { credentials: form } : {},
    });
    setBusy(false);
    setMessage(data.message || 'Test complete.');
  }

  async function disable(channel: string) {
    await api(`/api/channels/${channel}/disable`, { method: 'POST' });
    onChanged();
  }

  return (
    <section className="panel">
      <h2>Channel configuration</h2>
      <div className="channel-config-list">
        {channels.map((info) => {
          const isBuiltin = info.status === 'builtin';
          return (
            <div key={info.channel}>
              <div className="config-row">
                <span>
                  {info.label}
                  <small className="config-provider"> · {info.provider}</small>
                </span>
                <div className="config-actions">
                  {isBuiltin ? (
                    <span className="status approved">Built-in</span>
                  ) : (
                    <>
                      <span className={info.enabled ? 'status approved' : 'status pending'}>
                        {info.enabled ? 'Configured' : 'Not configured'}
                      </span>
                      <button type="button" className="channel-toggle" onClick={() => openEditor(info.channel)}>
                        {info.enabled ? 'Edit' : 'Set up'}
                      </button>
                      {info.enabled ? (
                        <button type="button" className="channel-toggle" onClick={() => void disable(info.channel)}>
                          Disable
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              </div>

              {editing === info.channel ? (
                <div className="credential-form">
                  {(credentialFields[info.channel] || []).map((field) => (
                    <label key={field.key}>
                      {field.label}
                      <input
                        type={field.secret ? 'password' : 'text'}
                        value={form[field.key] || ''}
                        onChange={(e) => setForm((current) => ({ ...current, [field.key]: e.target.value }))}
                      />
                    </label>
                  ))}
                  <div className="config-actions">
                    <button type="button" className="channel-toggle" disabled={busy} onClick={() => void test(info.channel)}>
                      Test connection
                    </button>
                    <button type="button" className="primary-button" disabled={busy} onClick={() => void save(info.channel)}>
                      Save
                    </button>
                    <button type="button" className="channel-toggle" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {message ? <p className="submit-message">{message}</p> : null}
      <p className="helper-copy">
        The web feed is always available. Configure credentials to enable additional delivery channels — they
        are encrypted at rest.
      </p>
    </section>
  );
}
