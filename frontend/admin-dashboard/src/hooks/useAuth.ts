import { useAuthStore } from '@/stores/auth.store';
import { authApi } from '@/services/auth.api';
import type { User } from '@/types';

export function useAuth() {
  const { user, token, isAuthenticated, login: setAuth, logout: clearAuth, setUser } = useAuthStore();

  const login = async (email: string, password: string) => {
    // In demo mode, simulate login
    const mockUser: User = {
      id: '1',
      email,
      name: 'Admin User',
      role: 'admin',
      tenantId: 'tenant-1',
    };
    setAuth(mockUser, 'mock-jwt-token');
    return mockUser;

    // Production:
    // const { user, tokens } = await authApi.login({ email, password });
    // setAuth(user, tokens.accessToken);
    // return user;
  };

  const register = async (companyName: string, name: string, email: string, password: string) => {
    const mockUser: User = {
      id: '1',
      email,
      name,
      role: 'admin',
      tenantId: 'tenant-1',
    };
    setAuth(mockUser, 'mock-jwt-token');
    return mockUser;
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } catch {
      // ignore
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

  return { user, token, isAuthenticated, login, register, logout, getCurrentUser };
}
