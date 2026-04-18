import axios from 'axios';
import { API_URL } from '@/utils/constants';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const storage = localStorage.getItem('va-auth-storage');
  if (storage) {
    try {
      const { state } = JSON.parse(storage);
      if (state?.token) {
        config.headers.Authorization = `Bearer ${state.token}`;
      }
    } catch {
      // ignore parse errors
    }
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('va-auth-storage');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
