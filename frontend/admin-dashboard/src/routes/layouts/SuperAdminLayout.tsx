import { Outlet } from 'react-router-dom';
import { SuperAdminSidebar } from '@/components/layout/SuperAdminSidebar';
import { SuperAdminHeader } from '@/components/layout/SuperAdminHeader';

export function SuperAdminLayout() {
  return (
    <div className="min-h-screen bg-slate-50">
      <SuperAdminSidebar />
      <div className="ml-[230px]">
        <SuperAdminHeader />
        <main className="px-6 py-6 animate-fade-in">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
