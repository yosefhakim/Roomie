import axios from 'axios';

const ACCESS_TOKEN_KEY = 'roomie_admin_access_token';
const REFRESH_TOKEN_KEY = 'roomie_admin_refresh_token';

export function getAccessToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken() {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setTokens({ accessToken, refreshToken }) {
  if (accessToken) localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  if (refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export const api = axios.create({
  baseURL: '/api',
  timeout: 15000,
});

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Single-flight refresh: if multiple requests 401 at once, only issue one
// refresh call and let the others wait on it.
let refreshPromise = null;

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;
    const code = error.response?.data?.error;

    const isAuthFailure = status === 401 && !original._retried && code !== 'ACCOUNT_BANNED';

    if (!isAuthFailure) {
      return Promise.reject(error);
    }

    original._retried = true;

    try {
      if (!refreshPromise) {
        const refreshToken = getRefreshToken();
        if (!refreshToken) throw new Error('No refresh token available');
        refreshPromise = axios
          .post('/api/auth/refresh', { refreshToken })
          .then((res) => {
            setTokens(res.data);
            return res.data.accessToken;
          })
          .finally(() => {
            refreshPromise = null;
          });
      }
      const newAccessToken = await refreshPromise;
      original.headers.Authorization = `Bearer ${newAccessToken}`;
      return api(original);
    } catch (refreshErr) {
      clearTokens();
      window.location.href = '/login';
      return Promise.reject(refreshErr);
    }
  }
);

export default api;
