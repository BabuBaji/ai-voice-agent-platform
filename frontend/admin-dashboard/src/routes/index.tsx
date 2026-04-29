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
import { AgentWizardPage } from '@/pages/agents/AgentWizardPage';
import { AgentTestPage } from '@/pages/agents/AgentTestPage';
import { AgentCallPage } from '@/pages/agents/AgentCallPage';
import { AgentLiveCallPage } from '@/pages/agents/AgentLiveCallPage';
import { AgentWebCallPage } from '@/pages/agents/AgentWebCallPage';
import { SupportPage } from '@/pages/support/SupportPage';
import { ReportDetailPage } from '@/pages/support/ReportDetailPage';
import { AdminReportsPage } from '@/pages/support/AdminReportsPage';
import { AdminReportDetailPage } from '@/pages/support/AdminReportDetailPage';
import { PublicReportPage } from '@/pages/support/PublicReportPage';
import { ContactPage } from '@/pages/contact/ContactPage';
import { AdminContactRequestsPage } from '@/pages/contact/AdminContactRequestsPage';
import { AdminContactDetailPage } from '@/pages/contact/AdminContactDetailPage';

// Calls
import { CallLogPage } from '@/pages/calls/CallLogPage';
import { CallDetailPage } from '@/pages/calls/CallDetailPage';

// Campaigns
import { CampaignsPage } from '@/pages/campaigns/CampaignsPage';
import { CampaignDetailPage } from '@/pages/campaigns/CampaignDetailPage';
import { CampaignWizardPage } from '@/pages/campaigns/CampaignWizardPage';

// CRM
import { LeadsPage } from '@/pages/crm/LeadsPage';
import { ContactsPage } from '@/pages/crm/ContactsPage';
import { PipelinePage } from '@/pages/crm/PipelinePage';
import { LeadDetailPage } from '@/pages/crm/LeadDetailPage';

// Knowledge
import { KnowledgeBasePage } from '@/pages/knowledge/KnowledgeBasePage';

// Voice cloning
import { VoiceCloningPage } from '@/pages/voiceCloning/VoiceCloningPage';
import { ChatbotsListPage } from '@/pages/chatbots/ChatbotsListPage';
import { ChatbotBuilderPage } from '@/pages/chatbots/ChatbotBuilderPage';
import { SuperAdminChatbotsPage } from '@/pages/superAdmin/ChatbotsPage';

// Workflows
import { WorkflowListPage } from '@/pages/workflows/WorkflowListPage';
import { WorkflowBuilderPage } from '@/pages/workflows/WorkflowBuilderPage';

// Analytics
import { AnalyticsPage } from '@/pages/analytics/AnalyticsPage';

// Stubs (sidebar parity, not yet implemented)
import { ComingSoonPage } from '@/pages/stub/ComingSoonPage';
import { WhatsAppPage } from '@/pages/chat/WhatsAppPage';

// Settings
import { GeneralSettingsPage } from '@/pages/settings/GeneralSettingsPage';
import { SettingsPage } from '@/pages/settings/SettingsPage';
import { PhoneNumbersPage } from '@/pages/settings/PhoneNumbersPage';
import { IntegrationsPage } from '@/pages/settings/IntegrationsPage';
import { TeamPage } from '@/pages/settings/TeamPage';
import { BillingPage } from '@/pages/settings/BillingPage';
import { PricingPage } from '@/pages/settings/PricingPage';
import { CheckoutPage } from '@/pages/settings/CheckoutPage';
import { AuditLogPage } from '@/pages/settings/AuditLogPage';
import { ApiKeysPage } from '@/pages/settings/ApiKeysPage';

// Docs (public, dedicated dark layout)
import { DocsPage } from '@/pages/docs/DocsPage';
import { DocArticlePage } from '@/pages/docs/DocArticlePage';

// Layouts
import { DashboardLayout } from '@/routes/layouts/DashboardLayout';
import { AuthLayout } from '@/routes/layouts/AuthLayout';
import { ProtectedRoute } from '@/routes/ProtectedRoute';

// Super admin (platform-level)
import { SuperAdminLayout } from '@/routes/layouts/SuperAdminLayout';
import { SuperAdminProtectedRoute } from '@/routes/SuperAdminProtectedRoute';
import { SuperAdminLoginPage } from '@/pages/superAdmin/SuperAdminLoginPage';
import { SuperAdminDashboardPage } from '@/pages/superAdmin/DashboardPage';
import { SuperAdminTenantsPage } from '@/pages/superAdmin/TenantsPage';
import { SuperAdminTenantDetailPage } from '@/pages/superAdmin/TenantDetailPage';
import { SuperAdminCallsPage } from '@/pages/superAdmin/CallsPage';
import { SuperAdminCallDetailPage } from '@/pages/superAdmin/CallDetailPage';
import { SuperAdminAgentsPage } from '@/pages/superAdmin/AgentsPage';
import { SuperAdminBillingPage } from '@/pages/superAdmin/BillingPage';
import { SuperAdminAuditLogsPage } from '@/pages/superAdmin/AuditLogsPage';
import { SuperAdminIntegrationsPage } from '@/pages/superAdmin/IntegrationsPage';
import { SuperAdminUserDetailPage } from '@/pages/superAdmin/UserDetailPage';
import { SuperAdminActivityFeedPage } from '@/pages/superAdmin/ActivityFeedPage';
import { SuperAdminFailedCallsPage } from '@/pages/superAdmin/FailedCallsPage';
import { SuperAdminAlertsPage } from '@/pages/superAdmin/AlertsPage';
import { SuperAdminWebhooksPage } from '@/pages/superAdmin/WebhooksPage';
import { SuperAdminBroadcastsPage } from '@/pages/superAdmin/BroadcastsPage';
import { SuperAdminCostAnalysisPage } from '@/pages/superAdmin/CostAnalysisPage';
import { SuperAdmin2FAPage } from '@/pages/superAdmin/TwoFactorPage';
import { SuperAdminSubscriptionsPage } from '@/pages/superAdmin/SubscriptionsPage';

export const routes: RouteObject[] = [
  // Public landing page
  {
    path: '/landing',
    element: <LandingPage />,
  },
  // Fullscreen checkout — protected (must be authed) but renders OUTSIDE the
  // dashboard chrome so the layout matches a Stripe-style payment surface.
  {
    path: '/settings/checkout',
    element: (
      <ProtectedRoute>
        <CheckoutPage />
      </ProtectedRoute>
    ),
  },
  // ── Super Admin (platform-level) ──────────────────────────────────────
  // Login is reachable without auth; everything else requires the
  // isPlatformAdmin claim on the JWT (enforced by both the route gate and
  // the backend middleware).
  { path: '/super-admin/login', element: <SuperAdminLoginPage /> },
  {
    element: (
      <SuperAdminProtectedRoute>
        <SuperAdminLayout />
      </SuperAdminProtectedRoute>
    ),
    children: [
      { path: '/super-admin', element: <SuperAdminDashboardPage /> },
      { path: '/super-admin/tenants', element: <SuperAdminTenantsPage /> },
      { path: '/super-admin/tenants/:id', element: <SuperAdminTenantDetailPage /> },
      { path: '/super-admin/calls', element: <SuperAdminCallsPage /> },
      { path: '/super-admin/calls/:id', element: <SuperAdminCallDetailPage /> },
      { path: '/super-admin/agents', element: <SuperAdminAgentsPage /> },
      { path: '/super-admin/chatbots', element: <SuperAdminChatbotsPage /> },
      { path: '/super-admin/billing', element: <SuperAdminBillingPage /> },
      { path: '/super-admin/audit-logs', element: <SuperAdminAuditLogsPage /> },
      { path: '/super-admin/integrations', element: <SuperAdminIntegrationsPage /> },
      { path: '/super-admin/users/:id', element: <SuperAdminUserDetailPage /> },
      { path: '/super-admin/activity', element: <SuperAdminActivityFeedPage /> },
      { path: '/super-admin/failed-calls', element: <SuperAdminFailedCallsPage /> },
      { path: '/super-admin/alerts', element: <SuperAdminAlertsPage /> },
      { path: '/super-admin/webhooks', element: <SuperAdminWebhooksPage /> },
      { path: '/super-admin/broadcasts', element: <SuperAdminBroadcastsPage /> },
      { path: '/super-admin/cost', element: <SuperAdminCostAnalysisPage /> },
      { path: '/super-admin/subscriptions', element: <SuperAdminSubscriptionsPage /> },
      { path: '/super-admin/2fa', element: <SuperAdmin2FAPage /> },
    ],
  },
  // Public docs hub (dedicated dark layout, no auth required)
  { path: '/docs', element: <DocsPage /> },
  { path: '/docs/article/:slug', element: <DocArticlePage /> },
  // Public report page — no auth, rate-limited + reCAPTCHA-ready
  { path: '/report', element: <PublicReportPage /> },
  // Public Contact Us marketing page
  { path: '/contact', element: <ContactPage /> },
  // Auth pages — full-screen standalone layouts (no AuthLayout wrapper) to
  // mirror the super-admin login chrome.
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
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
      { path: '/agents/new', element: <AgentWizardPage /> },
      { path: '/agents/:id', element: <AgentBuilderPage /> },
      { path: '/agents/:id/test', element: <AgentTestPage /> },
      { path: '/agents/:id/call', element: <AgentCallPage /> },
      { path: '/agents/:id/live-call', element: <AgentLiveCallPage /> },
      { path: '/agents/:id/web-call', element: <AgentWebCallPage /> },
      { path: '/calls', element: <CallLogPage /> },
      { path: '/calls/:id', element: <CallDetailPage /> },
      { path: '/campaigns', element: <CampaignsPage /> },
      { path: '/campaigns/new', element: <CampaignWizardPage /> },
      { path: '/campaigns/:id', element: <CampaignDetailPage /> },
      { path: '/crm/leads', element: <LeadsPage /> },
      { path: '/crm/leads/:id', element: <LeadDetailPage /> },
      { path: '/crm/contacts', element: <ContactsPage /> },
      { path: '/crm/pipeline', element: <PipelinePage /> },
      { path: '/knowledge', element: <KnowledgeBasePage /> },
      { path: '/voice-cloning', element: <VoiceCloningPage /> },
      { path: '/chatbots', element: <ChatbotsListPage /> },
      { path: '/chatbots/:id', element: <ChatbotBuilderPage /> },
      { path: '/workflows', element: <WorkflowListPage /> },
      { path: '/workflows/new', element: <WorkflowBuilderPage /> },
      { path: '/workflows/:id', element: <WorkflowBuilderPage /> },
      { path: '/analytics', element: <AnalyticsPage /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '/settings/legacy', element: <GeneralSettingsPage /> },
      { path: '/settings/phone-numbers', element: <PhoneNumbersPage /> },
      { path: '/settings/integrations', element: <IntegrationsPage /> },
      { path: '/settings/team', element: <TeamPage /> },
      { path: '/settings/billing', element: <BillingPage /> },
      { path: '/settings/pricing', element: <PricingPage /> },
      { path: '/pricing', element: <PricingPage /> },
      // Note: /settings/checkout is registered as a TOP-LEVEL fullscreen route
      // below — outside the DashboardLayout — so the sidebar/header don't
      // show during payment. The "/settings/" path is preserved so backlinks
      // from the pricing page resolve naturally.
      { path: '/settings/audit-log', element: <AuditLogPage /> },

      // ── Sidebar-parity stubs (matches OmniDim's nav even though we
      //    haven't built the full feature yet — clicking shows "Coming soon"
      //    instead of a 404 so the sidebar items are clickable).
      { path: '/chat/whatsapp', element: <WhatsAppPage /> },
      { path: '/settings/api', element: <ApiKeysPage /> },
      { path: '/support', element: <SupportPage /> },
      { path: '/support/:ticketId', element: <ReportDetailPage /> },
      { path: '/admin/reports', element: <AdminReportsPage /> },
      { path: '/admin/reports/:ticketId', element: <AdminReportDetailPage /> },
      { path: '/admin/contact-requests', element: <AdminContactRequestsPage /> },
      { path: '/admin/contact-requests/:refId', element: <AdminContactDetailPage /> },
      // Internal "Contact Us" entry — same form as the public /contact page,
      // but inside the DashboardLayout so the sidebar stays visible when
      // logged-in users open it from the sidebar.
      { path: '/help/contact', element: <ContactPage /> },
    ],
  },
];
