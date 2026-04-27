import axios from 'axios';
import { API_URL } from '@/utils/constants';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('va-access-token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const url: string = error.config?.url || '';
      // Don't auto-redirect when the failing request IS the login itself —
      // let the login page show its own "wrong credentials" error. Without
      // this, a wrong-password attempt at /super-admin/login flips the
      // window to /login (tenant portal) before the page can render an error.
      const isLoginCall = /\/auth\/(login|register|verify-otp|refresh)\b/.test(url);
      if (isLoginCall) return Promise.reject(error);

      localStorage.removeItem('va-access-token');
      localStorage.removeItem('va-refresh-token');
      localStorage.removeItem('va-auth-storage');

      // 401s coming from a super-admin page should bounce back to the
      // super-admin login, not the tenant login.
      const onSuperAdmin = window.location.pathname.startsWith('/super-admin');
      window.location.href = onSuperAdmin ? '/super-admin/login' : '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
