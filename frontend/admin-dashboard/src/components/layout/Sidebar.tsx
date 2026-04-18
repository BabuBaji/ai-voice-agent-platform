import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Bot, Phone, Users, BookOpen, Workflow,
  BarChart3, Settings, ChevronDown, ChevronLeft, ChevronRight,
  Mic, MessageSquare, Sparkles, Crown,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';

const iconMap: Record<string, React.ReactNode> = {
  LayoutDashboard: <LayoutDashboard className="h-[18px] w-[18px]" />,
  Bot: <Bot className="h-[18px] w-[18px]" />,
  Phone: <Phone className="h-[18px] w-[18px]" />,
  Users: <Users className="h-[18px] w-[18px]" />,
  BookOpen: <BookOpen className="h-[18px] w-[18px]" />,
  Workflow: <Workflow className="h-[18px] w-[18px]" />,
  BarChart3: <BarChart3 className="h-[18px] w-[18px]" />,
  Settings: <Settings className="h-[18px] w-[18px]" />,
  MessageSquare: <MessageSquare className="h-[18px] w-[18px]" />,
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
  { label: 'Phone Numbers', path: '/settings/phone-numbers', icon: 'Phone' },
  { label: 'Call Logs', path: '/calls', icon: 'Phone' },
  { label: 'Conversations', path: '/calls', icon: 'MessageSquare' },
  { label: 'Knowledge Base', path: '/knowledge', icon: 'BookOpen' },
  {
    label: 'CRM',
    icon: 'Users',
    children: [
      { label: 'Leads', path: '/crm/leads' },
      { label: 'Contacts', path: '/crm/contacts' },
      { label: 'Pipeline', path: '/crm/pipeline' },
    ],
  },
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
  const user = useAuthStore((s) => s.user);
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
      className={`fixed left-0 top-0 h-full bg-[#0f172a] z-30 transition-all duration-300 flex flex-col ${
        collapsed ? 'w-[72px]' : 'w-[260px]'
      }`}
    >
      {/* Logo */}
      <div className="h-16 flex items-center px-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-600 to-accent-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-primary-600/20">
            <Mic className="h-5 w-5 text-white" />
          </div>
          {!collapsed && (
            <div>
              <h1 className="text-white font-bold text-sm tracking-tight">VoiceAgent AI</h1>
              <p className="text-[10px] text-slate-400 opacity-60">Enterprise Platform</p>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 overflow-y-auto scrollbar-thin scrollbar-dark">
        <ul className="space-y-0.5 px-3">
          {navItems.map((item) => {
            if (item.children) {
              const groupActive = isGroupActive(item.children);
              const isExpanded = expandedGroups.includes(item.label);

              return (
                <li key={item.label}>
                  <button
                    onClick={() => !collapsed && toggleGroup(item.label)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                      groupActive
                        ? 'text-white bg-sidebar-active'
                        : 'text-slate-400 hover:text-white hover:bg-[#1e293b]'
                    }`}
                  >
                    {iconMap[item.icon]}
                    {!collapsed && (
                      <>
                        <span className="flex-1 text-left">{item.label}</span>
                        <ChevronDown
                          className={`h-4 w-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                        />
                      </>
                    )}
                  </button>
                  {!collapsed && isExpanded && (
                    <ul className="mt-1 ml-5 pl-4 border-l border-white/10 space-y-0.5">
                      {item.children.map((child) => (
                        <li key={child.path}>
                          <NavLink
                            to={child.path}
                            className={`block px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                              isActive(child.path)
                                ? 'text-white bg-primary-600/20 font-medium'
                                : 'text-slate-400 hover:text-white hover:bg-[#1e293b]'
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
              <li key={item.label}>
                <NavLink
                  to={item.path!}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                    isActive(item.path)
                      ? 'text-white bg-sidebar-active'
                      : 'text-slate-400 hover:text-white hover:bg-[#1e293b]'
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

      {/* Upgrade card */}
      {!collapsed && (
        <div className="px-3 pb-2">
          <div className="p-4 rounded-xl bg-gradient-to-r from-primary-600/20 to-accent-600/20 border border-primary-500/20">
            <div className="flex items-center gap-2 mb-2">
              <Crown className="h-4 w-4 text-yellow-400" />
              <span className="text-xs font-semibold text-white">Upgrade to Pro</span>
            </div>
            <p className="text-[11px] text-gray-400 mb-3">Get unlimited agents, calls, and premium features.</p>
            <button className="w-full py-1.5 px-3 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition-colors">
              View Plans
            </button>
          </div>
        </div>
      )}

      {/* User + Collapse */}
      <div className="p-3 border-t border-white/10">
        {/* User */}
        {!collapsed && user && (
          <div className="flex items-center gap-3 px-3 py-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-600 to-accent-600 flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
              {(user.name || 'A')[0].toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-white truncate">{user.name || 'Admin'}</p>
              <p className="text-[11px] text-slate-400 truncate">{user.email || ''}</p>
            </div>
          </div>
        )}

        <button
          onClick={onToggle}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-[#1e293b] transition-all duration-200 text-sm"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
