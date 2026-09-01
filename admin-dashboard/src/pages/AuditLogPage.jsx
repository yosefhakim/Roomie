import { useCallback } from 'react';
import { formatDistanceToNow } from 'date-fns';
import api from '../lib/api';
import { usePolling } from '../hooks/usePolling';
import Badge from '../components/Badge';

const ACTION_LABELS = {
  ban_user: { label: 'Banned user', variant: 'danger' },
  unban_user: { label: 'Unbanned user', variant: 'success' },
  grant_coins: { label: 'Granted coins', variant: 'success' },
  revoke_coins: { label: 'Revoked coins', variant: 'warning' },
  force_close_room: { label: 'Closed room', variant: 'danger' },
};

export default function AuditLogPage() {
  const fetchLog = useCallback(async () => {
    const res = await api.get('/admin/audit-log', { params: { limit: 100 } });
    return res.data.entries;
  }, []);

  const { data: entries, loading } = usePolling(fetchLog, { intervalMs: 8000 });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit Log</h1>
        <p className="text-textsecondary text-sm mt-1">Every administrative action, most recent first.</p>
      </div>

      <div className="card p-0 overflow-hidden">
        {loading && !entries && <div className="px-5 py-8 text-center text-textsecondary text-sm">Loading...</div>}
        {entries?.length === 0 && (
          <div className="px-5 py-8 text-center text-textsecondary text-sm">No admin actions recorded yet.</div>
        )}
        <ul className="divide-y divide-surface-border">
          {entries?.map((entry) => {
            const meta = ACTION_LABELS[entry.action] || { label: entry.action, variant: 'neutral' };
            return (
              <li key={entry.id} className="px-5 py-4 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                    {entry.target_username && (
                      <span className="text-sm text-textsecondary">
                        target: <span className="text-textprimary">@{entry.target_username}</span>
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-textsecondary">
                    by <span className="text-textprimary">@{entry.admin_username}</span>
                    {entry.metadata?.reason && <> — "{entry.metadata.reason}"</>}
                    {entry.metadata?.amount != null && <> — amount: {entry.metadata.amount}</>}
                  </div>
                </div>
                <div className="text-xs text-textsecondary shrink-0">
                  {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
