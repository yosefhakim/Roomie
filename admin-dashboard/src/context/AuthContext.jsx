import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api, { setTokens, clearTokens, getAccessToken } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // On mount, if we have a token, sanity-check it by hitting a lightweight
  // authenticated endpoint. We don't have a dedicated /me route in Layer 2,
  // so we reuse the analytics overview call - if it 401s, the interceptor's
  // refresh logic kicks in automatically; if that also fails we land on
  // /login via the interceptor's redirect.
  useEffect(() => {
    async function bootstrap() {
      const token = getAccessToken();
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const decoded = decodeJwtPayload(token);
        if (!decoded?.isAdmin) {
          clearTokens();
          setLoading(false);
          return;
        }
        setUser({ id: decoded.sub, username: decoded.username, displayName: decoded.displayName, isAdmin: true });
      } catch {
        clearTokens();
      } finally {
        setLoading(false);
      }
    }
    bootstrap();
  }, []);

  const login = useCallback(async (email, password) => {
    setError(null);
    try {
      const res = await api.post('/auth/login', { email, password });
      if (!res.data.user.isAdmin) {
        throw new Error('This account does not have admin access');
      }
      setTokens(res.data);
      setUser(res.data.user);
      return true;
    } catch (err) {
      const message = err.response?.data?.message || err.message || 'Login failed';
      setError(message);
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    clearTokens();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, error, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

// Minimal, non-verifying JWT payload decode for client-side UI decisions
// only (e.g. "does this look like an admin token so we show the dashboard
// shell"). This is NEVER a substitute for server-side verification - every
// API route re-verifies the token signature independently.
function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');
  const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=');
  return JSON.parse(atob(padded));
}
