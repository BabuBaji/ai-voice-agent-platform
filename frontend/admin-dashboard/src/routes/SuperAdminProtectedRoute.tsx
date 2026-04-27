import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth.store';

interface Props {
  children: React.ReactNode;
}

// Gate for the /super-admin/* tree. Two layers:
//   1. Must be authenticated.
//   2. The user record from the auth store must have isPlatformAdmin = true.
// We trust the local flag for the route gate, but the backend re-checks the
// JWT's isPlatformAdmin claim on every super-admin endpoint, so a tampered
// localStorage gets you a UI shell with 403s — not actual access.
export function SuperAdminProtectedRoute({ children }: Props) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/super-admin/login" state={{ from: location }} replace />;
  }
  if (!user?.isPlatformAdmin) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}
