import { useState } from 'react';
import { api } from '../api';

interface Props {
  audiences: Array<{ id: string; name: string; type: string }>;
  enabledChannels: Array<{ channel: string; label: string; enabled: boolean }>;
  username: string;
  onSaved: () => void;
}

export default function NotificationForm({ audiences, enabledChannels, username, onSaved }: Props) {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [details, setDetails] = useState('');
  const [audienceId, setAudienceId] = useState('');
  const [type, setType] = useState<'incident' | 'change' | 'maintenance' | 'general'>('incident');
  const [sendMode, setSendMode] = useState<'now' | 'scheduled'>('now');
  const [scheduledFor, setScheduledFor] = useState('');
  const [channels, setChannels] = useState<string[]>(['Web']);
  const [submitMessage, setSubmitMessage] = useState('');

  const audienceOptions =
    audiences.length > 0 ? audiences : [{ id: 'all-employees', name: 'All Employees', type: 'company' }];
  const selectedAudience = audienceOptions.find((audience) => audience.id === audienceId) || audienceOptions[0];

  const toggleChannel = (label: string) => {
    if (label === 'Web') return; // Web feed is always included.
    setChannels((current) =>
      current.includes(label) ? current.filter((item) => item !== label) : [...current, label],
    );
  };

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const payload = {
      title,
      type,
      summary,
      details,
      audience: { id: selectedAudience.id, name: selectedAudience.name, type: selectedAudience.type },
      requiredFieldsComplete: Boolean(title && summary && details),
      approvalState: 'submitted',
      scheduledFor: sendMode === 'scheduled' && scheduledFor ? new Date(scheduledFor).toISOString() : undefined,
      createdBy: username,
      channels,
    };

    const { ok, data } = await api('/api/notifications', { method: 'POST', body: payload });
    setSubmitMessage(ok ? `Saved: ${data.message}` : `Error: ${data.errors?.join(', ') || data.message}`);

    if (ok) {
      setTitle('');
      setSummary('');
      setDetails('');
      setSendMode('now');
      setScheduledFor('');
      setChannels(['Web']);
      onSaved();
    }
  }

  return (
    <form className="panel form-panel" onSubmit={handleSubmit}>
      <h2>Create notification</h2>

      <label>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} required />
      </label>

      <label>
        Type
        <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
          <option value="incident">Incident</option>
          <option value="change">Change</option>
          <option value="maintenance">Maintenance</option>
          <option value="general">General</option>
        </select>
      </label>

      <label>
        Audience
        <select value={selectedAudience.id} onChange={(e) => setAudienceId(e.target.value)}>
          {audienceOptions.map((audience) => (
            <option key={audience.id} value={audience.id}>
              {audience.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        Summary
        <textarea value={summary} onChange={(e) => setSummary(e.target.value)} required rows={3} />
      </label>

      <label>
        Details
        <textarea value={details} onChange={(e) => setDetails(e.target.value)} required rows={5} />
      </label>

      <div className="send-mode-panel">
        <label>
          <input type="radio" checked={sendMode === 'now'} onChange={() => setSendMode('now')} />
          Send now
        </label>
        <label>
          <input type="radio" checked={sendMode === 'scheduled'} onChange={() => setSendMode('scheduled')} />
          Schedule send
        </label>
      </div>

      {sendMode === 'scheduled' ? (
        <label>
          Scheduled time
          <input type="datetime-local" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} />
        </label>
      ) : null}

      <div className="channel-row">
        {enabledChannels.map(({ channel, label, enabled }) => {
          const isSelected = channels.includes(label);
          const isWeb = channel === 'web';
          return (
            <button
              key={channel}
              type="button"
              className={isSelected ? 'channel-toggle active' : 'channel-toggle'}
              onClick={() => enabled && toggleChannel(label)}
              disabled={!enabled || isWeb}
              title={
                isWeb
                  ? 'The web feed is always included'
                  : enabled
                    ? `Toggle ${label}`
                    : `${label} is not configured by an admin`
              }
            >
              {label}
            </button>
          );
        })}
      </div>

      <p className="helper-copy">
        Notices always appear on the web status feed. Other channels must be configured by an admin before
        they can be selected.
      </p>

      <button type="submit" className="primary-button">
        Submit for approval
      </button>
      {submitMessage ? <p className="submit-message">{submitMessage}</p> : null}
    </form>
  );
}
