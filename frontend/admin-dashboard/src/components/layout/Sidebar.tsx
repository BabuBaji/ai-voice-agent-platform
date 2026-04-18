import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Bot,
  Phone,
  Users,
  BookOpen,
  Workflow,
  BarChart3,
  Settings,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Mic,
} from 'lucide-react';

const iconMap: Record<string, React.ReactNode> = {
  LayoutDashboard: <LayoutDashboard className="h-5 w-5" />,
  Bot: <Bot className="h-5 w-5" />,
  Phone: <Phone className="h-5 w-5" />,
  Users: <Users className="h-5 w-5" />,
  BookOpen: <BookOpen className="h-5 w-5" />,
  Workflow: <Workflow className="h-5 w-5" />,
  BarChart3: <BarChart3 className="h-5 w-5" />,
  Settings: <Settings className="h-5 w-5" />,
};

interface NavItem {
  label: string;
  path?: string;
  icon: string;
  children?: { label: string; path: string }[];
}

const navItems: NavItem[] = [
  { label: 'Dashboard', path: '/', icon: 'LayoutDashboard' },
  { label: 'Agents', path: '/agents', icon: 'Bot' },
  { label: 'Calls', path: '/calls', icon: 'Phone' },
  {
    label: 'CRM',
    icon: 'Users',
    children: [
      { label: 'Leads', path: '/crm/leads' },
      { label: 'Contacts', path: '/crm/contacts' },
      { label: 'Pipeline', path: '/crm/pipeline' },
    ],
  },
  { label: 'Knowledge', path: '/knowledge', icon: 'BookOpen' },
  { label: 'Workflows', path: '/workflows', icon: 'Workflow' },
  { label: 'Analytics', path: '/analytics', icon: 'BarChart3' },
  { label: 'Settings', path: '/settings', icon: 'Settings' },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const location = useLocation();
  const [expandedGroups, setExpandedGroups] = useState<string[]>(['CRM']);

  const toggleGroup = (label: string) => {
    setExpandedGroups((prev) =>
      prev.includes(label) ? prev.filter((g) => g !== label) : [...prev, label]
    );
  };

  const isActive = (path?: string) => {
    if (!path) return false;
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const isGroupActive = (children?: { path: string }[]) => {
    return children?.some((c) => location.pathname.startsWith(c.path));
  };

  return (
    <aside
      className={`fixed left-0 top-0 h-full bg-sidebar-bg text-sidebar-text z-30 transition-all duration-300 flex flex-col ${
        collapsed ? 'w-[72px]' : 'w-[260px]'
      }`}
    >
      {/* Logo */}
      <div className="h-16 flex items-center px-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary-600 flex items-center justify-center flex-shrink-0">
            <Mic className="h-5 w-5 text-white" />
          </div>
          {!collapsed && (
            <div>
              <h1 className="text-white font-bold text-sm">VoiceAgent</h1>
              <p className="text-[10px] text-sidebar-text opacity-70">AI Platform</p>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 overflow-y-auto scrollbar-thin">
        <ul className="space-y-1 px-3">
          {navItems.map((item) => {
            if (item.children) {
              const groupActive = isGroupActive(item.children);
              const isExpanded = expandedGroups.includes(item.label);

              return (
                <li key={item.label}>
                  <button
                    onClick={() => !collapsed && toggleGroup(item.label)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      groupActive
                        ? 'text-white bg-sidebar-hover'
                        : 'text-sidebar-text hover:text-white hover:bg-sidebar-hover'
                    }`}
                  >
                    {iconMap[item.icon]}
                    {!collapsed && (
                      <>
                        <span className="flex-1 text-left">{item.label}</span>
                        <ChevronDown
                          className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        />
                      </>
                    )}
                  </button>
                  {!collapsed && isExpanded && (
                    <ul className="mt-1 ml-5 pl-4 border-l border-white/10 space-y-1">
                      {item.children.map((child) => (
                        <li key={child.path}>
                          <NavLink
                            to={child.path}
                            className={`block px-3 py-2 rounded-lg text-sm transition-colors ${
                              isActive(child.path)
                                ? 'text-white bg-primary-600/30'
                                : 'text-sidebar-text hover:text-white hover:bg-sidebar-hover'
                            }`}
                          >
                            {child.label}
                          </NavLink>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            }

            return (
              <li key={item.path}>
                <NavLink
                  to={item.path!}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive(item.path)
                      ? 'text-white bg-sidebar-active'
                      : 'text-sidebar-text hover:text-white hover:bg-sidebar-hover'
                  }`}
                >
                  {iconMap[item.icon]}
                  {!collapsed && <span>{item.label}</span>}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Collapse toggle */}
      <div className="p-3 border-t border-white/10">
        <button
          onClick={onToggle}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sidebar-text hover:text-white hover:bg-sidebar-hover transition-colors text-sm"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
