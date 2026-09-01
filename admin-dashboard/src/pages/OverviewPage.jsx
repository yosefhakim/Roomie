import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { Users, DoorOpen, TrendingUp, UserCheck } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import api from '../lib/api';
import { usePolling } from '../hooks/usePolling';
import StatCard from '../components/StatCard';

async function fetchOverview() {
  const res = await api.get('/admin/analytics/overview');
  return res.data;
}

async function fetchDauSeries() {
  const res = await api.get('/admin/analytics/dau', { params: { days: 30 } });
  return res.data.series;
}

async function fetchSignupSeries() {
  const res = await api.get('/admin/analytics/signups', { params: { days: 30 } });
  return res.data.series;
}

function formatDateLabel(dateStr) {
  try {
    return format(parseISO(dateStr), 'MMM d');
  } catch {
    return dateStr;
  }
}

const chartTooltipStyle = {
  backgroundColor: '#1e222d',
  border: '1px solid #2a2f3d',
  borderRadius: '8px',
  fontSize: '13px',
};

export default function OverviewPage() {
  const { data: overview } = usePolling(fetchOverview, { intervalMs: 8000 });
  const { data: dauSeries } = usePolling(fetchDauSeries, { intervalMs: 30000 });
  const { data: signupSeries } = usePolling(fetchSignupSeries, { intervalMs: 30000 });

  const dauChartData = (dauSeries || []).map((d) => ({
    date: formatDateLabel(d.activity_date),
    users: d.active_users,
  }));

  const signupChartData = (signupSeries || []).map((d) => ({
    date: formatDateLabel(d.signup_date),
    signups: d.count,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-textsecondary text-sm mt-1">Real-time platform health, refreshed automatically.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Users" value={overview?.users?.total ?? '—'} icon={Users} sublabel={`${overview?.users?.new_this_week ?? 0} new this week`} />
        <StatCard label="Daily Active Users" value={overview?.dau ?? '—'} icon={UserCheck} sublabel="Today" />
        <StatCard label="Monthly Active Users" value={overview?.mau ?? '—'} icon={TrendingUp} sublabel="Trailing 30 days" />
        <StatCard label="Active Rooms" value={overview?.activeRoomCount ?? '—'} icon={DoorOpen} sublabel={`${overview?.totalConnectedMembers ?? 0} members connected`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="font-medium mb-4">Daily Active Users (30d)</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dauChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3d" vertical={false} />
                <XAxis dataKey="date" stroke="#9aa1b0" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#9aa1b0" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={chartTooltipStyle} labelStyle={{ color: '#eceef2' }} />
                <Line type="monotone" dataKey="users" stroke="#7c5cff" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <h2 className="font-medium mb-4">New Signups (30d)</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={signupChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3d" vertical={false} />
                <XAxis dataKey="date" stroke="#9aa1b0" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#9aa1b0" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={chartTooltipStyle} labelStyle={{ color: '#eceef2' }} />
                <Bar dataKey="signups" fill="#3ecf8e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="font-medium mb-1">User Breakdown</h2>
        <p className="text-textsecondary text-sm mb-4">Snapshot of the current user base.</p>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-xl font-semibold">{overview?.users?.total ?? '—'}</div>
            <div className="text-xs text-textsecondary mt-1">Total</div>
          </div>
          <div>
            <div className="text-xl font-semibold text-danger">{overview?.users?.banned ?? '—'}</div>
            <div className="text-xs text-textsecondary mt-1">Banned</div>
          </div>
          <div>
            <div className="text-xl font-semibold text-accent">{overview?.users?.admins ?? '—'}</div>
            <div className="text-xs text-textsecondary mt-1">Admins</div>
          </div>
        </div>
      </div>
    </div>
  );
}
