import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { ImpersonationBanner } from '@/components/layout/ImpersonationBanner';
import { BroadcastBanner } from '@/components/layout/BroadcastBanner';
import { TenantAssistant } from '@/components/assistant/TenantAssistant';

export function DashboardLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-dashboard-bg">
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <div
        className={`transition-all duration-300 ${
          sidebarCollapsed ? 'ml-[68px]' : 'ml-[220px]'
        }`}
      >
        <ImpersonationBanner />
        <BroadcastBanner />
        <Header />
        <main className="px-4 py-4 animate-fade-in">
          <Outlet />
        </main>
      </div>
      <TenantAssistant />
    </div>
  );
}
