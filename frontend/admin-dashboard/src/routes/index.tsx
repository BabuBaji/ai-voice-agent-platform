import type { RouteObject } from 'react-router-dom';

// Landing
import { LandingPage } from '@/pages/LandingPage';

// Auth pages
import { LoginPage } from '@/pages/auth/LoginPage';
import { RegisterPage } from '@/pages/auth/RegisterPage';

// Dashboard
import { DashboardPage } from '@/pages/dashboard/DashboardPage';

// Agents
import { AgentListPage } from '@/pages/agents/AgentListPage';
import { AgentBuilderPage } from '@/pages/agents/AgentBuilderPage';
import { AgentTestPage } from '@/pages/agents/AgentTestPage';

// Calls
import { CallLogPage } from '@/pages/calls/CallLogPage';
import { CallDetailPage } from '@/pages/calls/CallDetailPage';

// CRM
import { LeadsPage } from '@/pages/crm/LeadsPage';
import { ContactsPage } from '@/pages/crm/ContactsPage';
import { PipelinePage } from '@/pages/crm/PipelinePage';
import { LeadDetailPage } from '@/pages/crm/LeadDetailPage';

// Knowledge
import { KnowledgeBasePage } from '@/pages/knowledge/KnowledgeBasePage';

// Workflows
import { WorkflowListPage } from '@/pages/workflows/WorkflowListPage';
import { WorkflowBuilderPage } from '@/pages/workflows/WorkflowBuilderPage';

// Analytics
import { AnalyticsPage } from '@/pages/analytics/AnalyticsPage';

// Settings
import { GeneralSettingsPage } from '@/pages/settings/GeneralSettingsPage';
import { PhoneNumbersPage } from '@/pages/settings/PhoneNumbersPage';
import { IntegrationsPage } from '@/pages/settings/IntegrationsPage';
import { TeamPage } from '@/pages/settings/TeamPage';
import { BillingPage } from '@/pages/settings/BillingPage';

// Layouts
import { DashboardLayout } from '@/routes/layouts/DashboardLayout';
import { AuthLayout } from '@/routes/layouts/AuthLayout';
import { ProtectedRoute } from '@/routes/ProtectedRoute';

export const routes: RouteObject[] = [
  // Public landing page
  {
    path: '/landing',
    element: <LandingPage />,
  },
  // Auth pages
  {
    element: <AuthLayout />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
    ],
  },
  // Dashboard (protected)
  {
    element: (
      <ProtectedRoute>
        <DashboardLayout />
      </ProtectedRoute>
    ),
    children: [
      { path: '/', element: <DashboardPage /> },
      { path: '/agents', element: <AgentListPage /> },
      { path: '/agents/new', element: <AgentBuilderPage /> },
      { path: '/agents/:id', element: <AgentBuilderPage /> },
      { path: '/agents/:id/test', element: <AgentTestPage /> },
      { path: '/calls', element: <CallLogPage /> },
      { path: '/calls/:id', element: <CallDetailPage /> },
      { path: '/crm/leads', element: <LeadsPage /> },
      { path: '/crm/leads/:id', element: <LeadDetailPage /> },
      { path: '/crm/contacts', element: <ContactsPage /> },
      { path: '/crm/pipeline', element: <PipelinePage /> },
      { path: '/knowledge', element: <KnowledgeBasePage /> },
      { path: '/workflows', element: <WorkflowListPage /> },
      { path: '/workflows/new', element: <WorkflowBuilderPage /> },
      { path: '/workflows/:id', element: <WorkflowBuilderPage /> },
      { path: '/analytics', element: <AnalyticsPage /> },
      { path: '/settings', element: <GeneralSettingsPage /> },
      { path: '/settings/phone-numbers', element: <PhoneNumbersPage /> },
      { path: '/settings/integrations', element: <IntegrationsPage /> },
      { path: '/settings/team', element: <TeamPage /> },
      { path: '/settings/billing', element: <BillingPage /> },
    ],
  },
];
