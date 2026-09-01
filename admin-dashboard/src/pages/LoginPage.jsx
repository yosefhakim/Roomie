import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Gamepad2, AlertCircle } from 'lucide-react';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const ok = await login(email, password);
    setSubmitting(false);
    if (ok) {
      navigate(location.state?.from?.pathname || '/', { replace: true });
    } else {
      setError('Invalid credentials or this account lacks admin access');
    }
  }

  return (
    <div className="h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-8">
          <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center">
            <Gamepad2 size={20} className="text-white" />
          </div>
          <span className="font-semibold text-xl tracking-tight">Roomie Admin</span>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4">
          <div>
            <label className="block text-sm font-medium text-textsecondary mb-1.5">Email</label>
            <input
              type="email"
              required
              autoFocus
              className="input w-full"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@roomie.app"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-textsecondary mb-1.5">Password</label>
            <input
              type="password"
              required
              className="input w-full"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-danger bg-danger/10 border border-danger/20 rounded-lg px-3 py-2">
              <AlertCircle size={16} className="shrink-0" />
              {error}
            </div>
          )}

          <button type="submit" disabled={submitting} className="btn-primary w-full">
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p className="text-xs text-textsecondary text-center mt-4">
          Only accounts with <code>is_admin = true</code> can access this dashboard.
        </p>
      </div>
    </div>
  );
}
