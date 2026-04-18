import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';

const pathLabels: Record<string, string> = {
  '': 'Dashboard',
  agents: 'Agents',
  calls: 'Call Logs',
  crm: 'CRM',
  leads: 'Leads',
  contacts: 'Contacts',
  pipeline: 'Pipeline',
  knowledge: 'Knowledge Base',
  workflows: 'Workflows',
  analytics: 'Analytics',
  settings: 'Settings',
  new: 'New',
  builder: 'Builder',
  test: 'Test',
  general: 'General',
  'phone-numbers': 'Phone Numbers',
  integrations: 'Integrations',
  team: 'Team',
  billing: 'Billing',
};

export function Breadcrumb() {
  const location = useLocation();
  const pathSegments = location.pathname.split('/').filter(Boolean);

  const crumbs = pathSegments.map((seg, idx) => ({
    label: pathLabels[seg] || seg.charAt(0).toUpperCase() + seg.slice(1),
    path: '/' + pathSegments.slice(0, idx + 1).join('/'),
    isLast: idx === pathSegments.length - 1,
  }));

  return (
    <nav className="flex items-center gap-1.5 text-sm">
      <Link to="/" className="text-gray-400 hover:text-gray-600 transition-colors p-0.5">
        <Home className="h-4 w-4" />
      </Link>
      {crumbs.map((crumb) => (
        <div key={crumb.path} className="flex items-center gap-1.5">
          <ChevronRight className="h-3.5 w-3.5 text-gray-300" />
          {crumb.isLast ? (
            <span className="text-gray-900 font-medium">{crumb.label}</span>
          ) : (
            <Link to={crumb.path} className="text-gray-500 hover:text-gray-700 transition-colors">
              {crumb.label}
            </Link>
          )}
        </div>
      ))}
    </nav>
  );
}
