import { Bell, Search, LogOut, User, Settings, HelpCircle, Command } from 'lucide-react';
import { Breadcrumb } from './Breadcrumb';
import { Dropdown } from '@/components/ui/Dropdown';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';

export function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const userMenuItems = [
    {
      label: 'Profile',
      icon: <User className="h-4 w-4" />,
      onClick: () => navigate('/settings'),
    },
    {
      label: 'Settings',
      icon: <Settings className="h-4 w-4" />,
      onClick: () => navigate('/settings'),
    },
    {
      label: 'Help & Support',
      icon: <HelpCircle className="h-4 w-4" />,
      onClick: () => {},
    },
    {
      label: 'Sign out',
      icon: <LogOut className="h-4 w-4" />,
      onClick: () => {
        logout();
        navigate('/login');
      },
      danger: true,
      divider: true,
    },
  ];

  return (
    <header className="h-16 bg-white border-b border-gray-100 flex items-center justify-between px-6 sticky top-0 z-20">
      <Breadcrumb />

      <div className="flex items-center gap-2">
        {/* Search */}
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search..."
            className="w-64 pl-9 pr-12 py-2 text-sm border border-gray-200 rounded-xl bg-gray-50/50 focus:bg-white focus:border-primary-300 focus:ring-2 focus:ring-primary-100 focus:outline-none transition-all"
          />
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium text-gray-400 bg-gray-100 border border-gray-200 rounded">
            <Command className="h-2.5 w-2.5" />K
          </kbd>
        </div>

        {/* Notifications */}
        <button className="relative p-2 rounded-xl text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors">
          <Bell className="h-5 w-5" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-danger-500 rounded-full ring-2 ring-white" />
        </button>

        {/* Separator */}
        <div className="w-px h-6 bg-gray-200 mx-1" />

        {/* User menu */}
        <Dropdown
          trigger={
            <div className="flex items-center gap-2.5 pl-2 pr-1 py-1 rounded-xl hover:bg-gray-50 transition-colors cursor-pointer">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-medium text-gray-900 leading-tight">{user?.name || 'Admin User'}</p>
                <p className="text-[11px] text-gray-500 capitalize">{user?.role || 'admin'}</p>
              </div>
              <div className="w-8 h-8 rounded-full bg-gradient-brand text-white flex items-center justify-center text-sm font-semibold shadow-sm">
                {(user?.name || 'A')[0].toUpperCase()}
              </div>
            </div>
          }
          items={userMenuItems}
        />
      </div>
    </header>
  );
}
