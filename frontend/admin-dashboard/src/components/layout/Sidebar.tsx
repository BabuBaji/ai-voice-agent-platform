import React, { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Bot, Phone, Users, BookOpen, Workflow,
  BarChart3, Settings, ChevronDown, ChevronLeft, ChevronRight,
  Mic, MessageSquare, Sparkles, Megaphone, ScrollText,
  PhoneCall, Puzzle, CreditCard, Key, FileText, Mail, Bug, LogOut,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

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
  Mic: <Mic className="h-[18px] w-[18px]" />,
  Sparkles: <Sparkles className="h-[18px] w-[18px]" />,
  Megaphone: <Megaphone className="h-[18px] w-[18px]" />,
  ScrollText: <ScrollText className="h-[18px] w-[18px]" />,
  PhoneCall: <PhoneCall className="h-[18px] w-[18px]" />,
  Puzzle: <Puzzle className="h-[18px] w-[18px]" />,
  CreditCard: <CreditCard className="h-[18px] w-[18px]" />,
  Key: <Key className="h-[18px] w-[18px]" />,
  FileText: <FileText className="h-[18px] w-[18px]" />,
  Mail: <Mail className="h-[18px] w-[18px]" />,
  Bug: <Bug className="h-[18px] w-[18px]" />,
};

interface NavItem {
  label: string;
  path?: string;
  icon: string;
  badge?: string; // e.g. "New"
  children?: { label: string; path: string }[];
  external?: boolean;
}

interface NavSection {
  title: string; // small uppercase header above the items
  items: NavItem[];
}

// Sidebar grouping mirrors OmniDim with our extras inlined where they fit.
// Dashboard sits in its own ungrouped slot at the very top so it's always
// one click away. Workflows + CRM live next to "Operations & Monitoring"
// so all the day-to-day operator tools are clustered together.
const navSections: NavSection[] = [
  {
    title: '',
    items: [
      { label: 'Dashboard', path: '/', icon: 'LayoutDashboard' },
    ],
  },
  {
    title: 'Voice AI Setup',
    items: [
      { label: 'Voice AI Assistants', path: '/agents', icon: 'Bot' },
      { label: 'Clone Voice', path: '/voice-cloning', icon: 'Sparkles', badge: 'New' },
      { label: 'Files', path: '/knowledge', icon: 'BookOpen' },
      { label: 'Integrations', path: '/settings/integrations', icon: 'Puzzle' },
    ],
  },
  {
    title: 'Operations & Monitoring',
    items: [
      { label: 'Phone Numbers', path: '/settings/phone-numbers', icon: 'Phone' },
      { label: 'Bulk Call', path: '/campaigns', icon: 'Megaphone' },
      { label: 'Call Logs', path: '/calls', icon: 'PhoneCall' },
      { label: 'Analytics', path: '/analytics', icon: 'BarChart3' },
      { label: 'Workflows', path: '/workflows', icon: 'Workflow' },
      {
        label: 'CRM',
        icon: 'Users',
        children: [
          { label: 'Leads', path: '/crm/leads' },
          { label: 'Contacts', path: '/crm/contacts' },
          { label: 'Pipeline', path: '/crm/pipeline' },
        ],
      },
    ],
  },
  {
    title: 'Chat',
    items: [
      { label: 'Chatbots', path: '/chatbots', icon: 'Bot', badge: 'New' },
      { label: 'WhatsApp', path: '/chat/whatsapp', icon: 'MessageSquare' },
    ],
  },
  {
    title: 'Account & Billing',
    items: [
      { label: 'Billing', path: '/settings/billing', icon: 'CreditCard' },
      { label: 'API', path: '/settings/api', icon: 'Key' },
      { label: 'Audit Log', path: '/settings/audit-log', icon: 'ScrollText' },
      { label: 'Settings', path: '/settings', icon: 'Settings' },
    ],
  },
  {
    title: 'Resources',
    items: [
      { label: 'Docs', path: '/docs', icon: 'FileText' },
      { label: 'Contact Us', path: '/help/contact', icon: 'Mail' },
      { label: 'Report Issue', path: '/support', icon: 'Bug' },
    ],
  },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [expandedGroups, setExpandedGroups] = useState<string[]>(['CRM']);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

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
        collapsed ? 'w-[68px]' : 'w-[220px]'
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

      {/* Navigation — compact rhythm, tighter sections + smaller item padding */}
      <nav className="flex-1 py-2 overflow-y-auto scrollbar-thin scrollbar-dark">
        {navSections.map((section, idx) => (
          <div key={section.title || `__top-${idx}`} className="mb-2">
            {!collapsed && section.title && (
              <p className="px-5 mb-0.5 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                {section.title}
              </p>
            )}
            <ul className="px-3">
              {section.items.map((item) => {
                if (item.children) {
                  const groupActive = isGroupActive(item.children);
                  const isExpanded = expandedGroups.includes(item.label);
                  return (
                    <li key={item.label}>
                      <button
                        onClick={() => !collapsed && toggleGroup(item.label)}
                        className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
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
                              className={`h-3.5 w-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                            />
                          </>
                        )}
                      </button>
                      {!collapsed && isExpanded && (
                        <ul className="mt-0.5 ml-5 pl-4 border-l border-white/10">
                          {item.children.map((child) => (
                            <li key={child.path}>
                              <NavLink
                                to={child.path}
                                className={`block px-3 py-1.5 rounded-md text-[13px] transition-colors ${
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
                      className={`flex items-center gap-3 px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
                        isActive(item.path)
                          ? 'text-white bg-sidebar-active'
                          : 'text-slate-400 hover:text-white hover:bg-[#1e293b]'
                      }`}
                    >
                      {iconMap[item.icon]}
                      {!collapsed && (
                        <>
                          <span className="flex-1">{item.label}</span>
                          {item.badge && (
                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-orange-500 text-white tracking-wide">
                              {item.badge}
                            </span>
                          )}
                        </>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Sign out + collapse */}
      <div className="p-2 border-t border-white/10 space-y-1">
        <button
          onClick={handleLogout}
          title="Sign out"
          className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-slate-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors text-[13px]"
        >
          <LogOut className="h-4 w-4 flex-shrink-0" />
          {!collapsed && <span>Sign out</span>}
        </button>
        <button
          onClick={onToggle}
          className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-slate-400 hover:text-white hover:bg-[#1e293b] transition-colors text-xs"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
