export default function StatCard({ label, value, sublabel, icon: Icon, trend }) {
  return (
    <div className="card">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-textsecondary text-sm font-medium">{label}</div>
          <div className="text-2xl font-semibold mt-1.5 tracking-tight">{value}</div>
          {sublabel && <div className="text-xs text-textsecondary mt-1">{sublabel}</div>}
        </div>
        {Icon && (
          <div className="w-9 h-9 rounded-lg bg-accent-muted flex items-center justify-center shrink-0">
            <Icon size={18} className="text-accent" />
          </div>
        )}
      </div>
      {trend != null && (
        <div className={`text-xs mt-3 font-medium ${trend >= 0 ? 'text-success' : 'text-danger'}`}>
          {trend >= 0 ? '+' : ''}
          {trend}% vs last period
        </div>
      )}
    </div>
  );
}
