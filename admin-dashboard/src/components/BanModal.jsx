import { useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import api from '../lib/api';

export default function BanModal({ user, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!reason.trim()) {
      setError('A reason is required');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/admin/users/${user.id}/ban`, { reason: reason.trim() });
      onDone();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to ban user');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
      <div className="card w-full max-w-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-danger" />
            <h3 className="font-medium">Ban {user.display_name}</h3>
          </div>
          <button onClick={onClose} className="text-textsecondary hover:text-textprimary">
            <X size={18} />
          </button>
        </div>

        <p className="text-sm text-textsecondary mb-4">
          This immediately revokes all active sessions and prevents login and socket connections.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-textsecondary mb-1.5">Reason (logged to audit trail)</label>
            <textarea
              className="input w-full min-h-[80px]"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Repeated harassment reports in voice rooms"
              autoFocus
            />
          </div>

          {error && <div className="text-sm text-danger">{error}</div>}

          <button type="submit" disabled={submitting} className="btn-danger w-full">
            {submitting ? 'Banning...' : 'Confirm ban'}
          </button>
        </form>
      </div>
    </div>
  );
}
