import { useState, useCallback } from 'react';
import { DoorOpen, Users as UsersIcon, X, Lock, Globe, KeyRound } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import api from '../lib/api';
import { usePolling } from '../hooks/usePolling';
import Badge from '../components/Badge';

const VISIBILITY_ICON = { public: Globe, private: Lock, password: KeyRound };

export default function RoomsPage() {
  const [closingId, setClosingId] = useState(null);

  const fetchRooms = useCallback(async () => {
    const res = await api.get('/admin/rooms', { params: { limit: 200 } });
    return res.data;
  }, []);

  const { data, loading, refetch } = usePolling(fetchRooms, { intervalMs: 5000 });

  async function handleClose(room) {
    if (!window.confirm(`Force-close "${room.name}"? All ${room.memberCount} members will be disconnected.`)) return;
    setClosingId(room.id);
    try {
      await api.post(`/admin/rooms/${room.id}/close`);
      refetch();
    } finally {
      setClosingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Rooms</h1>
        <p className="text-textsecondary text-sm mt-1">{data?.count ?? '—'} active rooms right now</p>
      </div>

      {loading && !data && <div className="text-textsecondary text-sm">Loading...</div>}

      {data?.rooms?.length === 0 && (
        <div className="card text-center py-12 text-textsecondary">
          <DoorOpen size={28} className="mx-auto mb-3 opacity-50" />
          No active rooms at the moment.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {data?.rooms?.map((room) => {
          const VisIcon = VISIBILITY_ICON[room.visibility] || Globe;
          return (
            <div key={room.id} className="card">
              <div className="flex items-start justify-between mb-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{room.name}</div>
                  <div className="text-xs text-textsecondary mt-0.5">
                    Created {formatDistanceToNow(new Date(room.createdAt), { addSuffix: true })}
                  </div>
                </div>
                <button
                  onClick={() => handleClose(room)}
                  disabled={closingId === room.id}
                  className="text-textsecondary hover:text-danger transition-colors shrink-0"
                  title="Force close room"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex items-center gap-2 mb-3">
                <Badge variant="neutral">
                  <VisIcon size={12} className="mr-1" />
                  {room.visibility}
                </Badge>
                <Badge variant="accent">
                  <UsersIcon size={12} className="mr-1" />
                  {room.memberCount}/{room.maxMembers}
                </Badge>
              </div>

              <div className="flex -space-x-2">
                {room.members.slice(0, 6).map((m) => (
                  <div
                    key={m.userId}
                    title={m.displayName}
                    className={`w-7 h-7 rounded-full border-2 border-surface-raised flex items-center justify-center text-xs font-semibold ${
                      m.connected ? 'bg-accent-muted text-accent' : 'bg-surface-overlay text-textsecondary'
                    }`}
                  >
                    {m.displayName?.[0]?.toUpperCase() || '?'}
                  </div>
                ))}
                {room.members.length > 6 && (
                  <div className="w-7 h-7 rounded-full border-2 border-surface-raised bg-surface-overlay flex items-center justify-center text-xs text-textsecondary">
                    +{room.members.length - 6}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
