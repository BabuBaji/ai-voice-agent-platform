import { useAuthStore } from '@/stores/auth.store';
import { authApi } from '@/services/auth.api';

export function useAuth() {
  const { user, accessToken, refreshToken, isAuthenticated, login: setAuth, logout: clearAuth, setUser } = useAuthStore();

  const login = async (email: string, password: string) => {
    const response = await authApi.login({ email, password });
    setAuth(response.user, response.accessToken, response.refreshToken);
    return response.user;
  };

  const register = async (companyName: string, name: string, email: string, password: string) => {
    const response = await authApi.register({ companyName, name, email, password });
    setAuth(response.user, response.accessToken, response.refreshToken);
    return response.user;
  };

  const logout = async () => {
    try {
      const rt = refreshToken || localStorage.getItem('va-refresh-token');
      if (rt) {
        await authApi.logout(rt);
      }
    } catch {
      // ignore logout API errors - clear local state regardless
    }
    clearAuth();
  };

  const getCurrentUser = async () => {
    if (user) return user;
    try {
      const currentUser = await authApi.getCurrentUser();
      setUser(currentUser);
      return currentUser;
    } catch {
      clearAuth();
      return null;
    }
  };

  return { user, token: accessToken, isAuthenticated, login, register, logout, getCurrentUser };
}
