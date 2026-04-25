import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth.store';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const location = useLocation();

  if (!isAuthenticated) {
    // Send unauthenticated visitors to the public landing page (which has
    // sign-in / sign-up CTAs) rather than the bare login form.
    return <Navigate to="/landing" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
