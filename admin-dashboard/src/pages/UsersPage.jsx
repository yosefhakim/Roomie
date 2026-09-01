import { useState, useCallback } from 'react';
import { Search, Coins, Ban, ShieldCheck } from 'lucide-react';
import { format } from 'date-fns';
import api from '../lib/api';
import { usePolling } from '../hooks/usePolling';
import Badge from '../components/Badge';
import CoinAdjustModal from '../components/CoinAdjustModal';
import BanModal from '../components/BanModal';

const PAGE_SIZE = 20;

export default function UsersPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [coinModalUser, setCoinModalUser] = useState(null);
  const [banModalUser, setBanModalUser] = useState(null);

  const fetchUsers = useCallback(async () => {
    const res = await api.get('/admin/users', {
      params: { limit: PAGE_SIZE, offset: page * PAGE_SIZE, search: search || undefined },
    });
    return res.data;
  }, [page, search]);

  const { data, loading, refetch } = usePolling(fetchUsers, { intervalMs: 10000, deps: [page, search] });

  async function handleUnban(user) {
    await api.post(`/admin/users/${user.id}/unban`);
    refetch();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="text-textsecondary text-sm mt-1">{data?.total ?? '—'} total accounts</p>
        </div>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-textsecondary" />
          <input
            className="input pl-9 w-64"
            placeholder="Search username, email, name..."
            value={search}
            onChange={(e) => {
              setPage(0);
              setSearch(e.target.value);
            }}
          />
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border text-left text-textsecondary">
              <th className="px-5 py-3 font-medium">User</th>
              <th className="px-5 py-3 font-medium">Email</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Joined</th>
              <th className="px-5 py-3 font-medium">Last login</th>
              <th className="px-5 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-textsecondary">
                  Loading...
                </td>
              </tr>
            )}
            {data?.users?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-textsecondary">
                  No users found.
                </td>
              </tr>
            )}
            {data?.users?.map((u) => (
              <tr key={u.id} className="border-b border-surface-border last:border-0 hover:bg-surface-overlay/50">
                <td className="px-5 py-3">
                  <div className="font-medium">{u.display_name}</div>
                  <div className="text-textsecondary text-xs">@{u.username}</div>
                </td>
                <td className="px-5 py-3 text-textsecondary">{u.email || '—'}</td>
                <td className="px-5 py-3">
                  {u.is_banned ? (
                    <Badge variant="danger">Banned</Badge>
                  ) : u.is_admin ? (
                    <Badge variant="accent">Admin</Badge>
                  ) : (
                    <Badge variant="success">Active</Badge>
                  )}
                </td>
                <td className="px-5 py-3 text-textsecondary">{format(new Date(u.created_at), 'MMM d, yyyy')}</td>
                <td className="px-5 py-3 text-textsecondary">
                  {u.last_login_at ? format(new Date(u.last_login_at), 'MMM d, yyyy') : 'Never'}
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2 justify-end">
                    <button
                      onClick={() => setCoinModalUser(u)}
                      className="btn-secondary !px-2 !py-1.5"
                      title="Adjust coins"
                    >
                      <Coins size={14} />
                    </button>
                    {u.is_banned ? (
                      <button
                        onClick={() => handleUnban(u)}
                        className="btn-secondary !px-2 !py-1.5"
                        title="Unban"
                      >
                        <ShieldCheck size={14} />
                      </button>
                    ) : (
                      !u.is_admin && (
                        <button
                          onClick={() => setBanModalUser(u)}
                          className="btn-secondary !px-2 !py-1.5 hover:!text-danger"
                          title="Ban"
                        >
                          <Ban size={14} />
                        </button>
                      )
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <button
          className="btn-secondary"
          disabled={page === 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
        >
          Previous
        </button>
        <span className="text-sm text-textsecondary">Page {page + 1}</span>
        <button
          className="btn-secondary"
          disabled={!data || data.users.length < PAGE_SIZE}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>

      {coinModalUser && (
        <CoinAdjustModal
          user={coinModalUser}
          onClose={() => setCoinModalUser(null)}
          onDone={() => {
            setCoinModalUser(null);
            refetch();
          }}
        />
      )}
      {banModalUser && (
        <BanModal
          user={banModalUser}
          onClose={() => setBanModalUser(null)}
          onDone={() => {
            setBanModalUser(null);
            refetch();
          }}
        />
      )}
    </div>
  );
}
