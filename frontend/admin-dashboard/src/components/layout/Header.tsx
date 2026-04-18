import { Bell, Search, LogOut, User, Settings } from 'lucide-react';
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
    <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6">
      <Breadcrumb />

      <div className="flex items-center gap-3">
        {/* Search */}
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search..."
            className="w-64 pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:bg-white focus:border-primary-300 focus:ring-2 focus:ring-primary-100 focus:outline-none transition-colors"
          />
        </div>

        {/* Notifications */}
        <button className="relative p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors">
          <Bell className="h-5 w-5" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-danger-500 rounded-full" />
        </button>

        {/* User menu */}
        <Dropdown
          trigger={
            <div className="flex items-center gap-2 pl-3 pr-1 py-1 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-medium text-gray-900">{user?.name || 'Admin User'}</p>
                <p className="text-xs text-gray-500">{user?.role || 'admin'}</p>
              </div>
              <div className="w-8 h-8 rounded-full bg-primary-600 text-white flex items-center justify-center text-sm font-medium">
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
