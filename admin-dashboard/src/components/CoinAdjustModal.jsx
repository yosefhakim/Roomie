import { useState } from 'react';
import { X } from 'lucide-react';
import api from '../lib/api';

export default function CoinAdjustModal({ user, onClose, onDone }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [direction, setDirection] = useState('grant');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    const parsed = parseInt(amount, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Enter a positive whole number');
      return;
    }
    if (!reason.trim()) {
      setError('A reason is required for the audit log');
      return;
    }

    setSubmitting(true);
    try {
      await api.post(`/admin/users/${user.id}/coins`, {
        amount: direction === 'grant' ? parsed : -parsed,
        reason: reason.trim(),
      });
      onDone();
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.error || 'Failed to adjust coins');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
      <div className="card w-full max-w-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium">Adjust coins for {user.display_name}</h3>
          <button onClick={onClose} className="text-textsecondary hover:text-textprimary">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDirection('grant')}
              className={direction === 'grant' ? 'btn-primary flex-1' : 'btn-secondary flex-1'}
            >
              Grant
            </button>
            <button
              type="button"
              onClick={() => setDirection('revoke')}
              className={direction === 'revoke' ? 'btn-danger flex-1' : 'btn-secondary flex-1'}
            >
              Revoke
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium text-textsecondary mb-1.5">Amount</label>
            <input
              type="number"
              min="1"
              className="input w-full"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="1000"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-textsecondary mb-1.5">Reason (logged to audit trail)</label>
            <input
              type="text"
              className="input w-full"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Compensation for reported bug"
            />
          </div>

          {error && <div className="text-sm text-danger">{error}</div>}

          <button type="submit" disabled={submitting} className="btn-primary w-full">
            {submitting ? 'Applying...' : `Confirm ${direction}`}
          </button>
        </form>
      </div>
    </div>
  );
}
