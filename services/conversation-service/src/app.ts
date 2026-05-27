import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { healthRouter } from './routes/health';
import { conversationRouter } from './routes/conversations';
import { messageRouter } from './routes/messages';
import { recordingRouter } from './routes/recordings';
import { translateRouter } from './routes/translate';
import { webCallRouter } from './routes/webCalls';
import { webCallInternalRouter } from './routes/webCallsInternal';
import { userReportRouter, adminReportRouter } from './routes/support';
import { publicContactRouter, adminContactRouter } from './routes/contact';
import { postCallLeadRouter } from './routes/postCallLead';
import { whatsappIntegrationRouter } from './routes/whatsappIntegration';
import { plivoIntegrationRouter } from './routes/plivoIntegration';
import { metaWhatsappWebhookRouter } from './routes/metaWhatsappWebhook';
import { metaLeadAdsWebhookRouter } from './routes/metaLeadAdsWebhook';
import { whatsappTemplatesRouter } from './routes/whatsappTemplates';
import { whatsappCampaignsRouter } from './routes/whatsappCampaigns';
import { whatsappWorkflowsRouter } from './routes/whatsappWorkflows';
import { whatsappRetryQueueRouter } from './routes/whatsappRetryQueue';
import { whatsappAnalyticsRouter } from './routes/whatsappAnalytics';
import { followupRouter } from './routes/followups';
import { followupFeaturesRouter } from './routes/followupFeatures';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';

const app = express();

app.use(helmet());
app.use(cors());

// Recording upload/serve router must be mounted BEFORE express.json()
// so the raw audio body isn't parsed as JSON.
app.use('/api/v1', recordingRouter);

// Capture raw body on every JSON request so the Meta WhatsApp webhook can
// verify the x-hub-signature-256 HMAC. Cheap (~one Buffer reference per
// request) and non-intrusive — handlers that don't need rawBody just ignore it.
app.use(express.json({
  limit: '10mb',
  verify: (req, _res, buf) => {
    (req as any).rawBody = buf;
  },
}));
app.use(requestLogger);

// Health check
app.use('/health', healthRouter);

// API routes - tenant middleware is inline in routes
app.use('/api/v1/conversations', conversationRouter);
app.use('/api/v1', messageRouter);
app.use('/api/v1/web-calls', webCallRouter);
app.use('/internal', webCallInternalRouter);
app.use('/api/v1/reports', userReportRouter);
app.use('/api/v1/admin/reports', adminReportRouter);
app.use('/api/v1/contact', publicContactRouter);
app.use('/api/v1/admin/contact-requests', adminContactRouter);
app.use('/api/v1', translateRouter);
// Post-call lead module: follow-up tasks, counselors, college brochures,
// communication logs, manual email/WhatsApp triggers. Mounted at the
// generic /api/v1 root because the router defines its own path prefixes
// (/follow-ups, /counselors, /college-brochures, /communications/...).
app.use('/api/v1', postCallLeadRouter);
// Per-tenant WhatsApp integration (provider creds, encrypted at rest).
app.use('/api/v1/integrations', whatsappIntegrationRouter);
// Per-tenant Plivo integration (SMS + WhatsApp via one Plivo account, DLT-aware).
app.use('/api/v1/integrations', plivoIntegrationRouter);
// Meta WhatsApp Cloud webhook (GET verify + POST delivery/status callbacks).
// Mounted at root so the public URL is /webhooks/meta/whatsapp — that's the
// URL you paste into Meta App dashboard → WhatsApp → Configuration.
app.use(metaWhatsappWebhookRouter);
// Meta Lead Ads webhook: ingests Lead Form submissions, POSTs them into
// crm-service-node /leads as source='meta_ads', which then triggers
// lead_created in the workflow engine.
app.use(metaLeadAdsWebhookRouter);
// WhatsApp template catalogue: list, sync from Meta, manage variable mapping,
// test send. Routes are tenant-scoped via x-tenant-id header.
app.use('/api/v1/whatsapp', whatsappTemplatesRouter);
// Bulk WhatsApp campaigns. Targets are drained by the campaign worker
// (started in index.ts) at the per-campaign rate_limit_per_minute.
app.use('/api/v1/whatsapp', whatsappCampaignsRouter);
// Lead-lifecycle workflow engine: maps {workflow_event} → template send +
// counselor assignment + admin notification. Internal /trigger is called by
// crm-service-node on lead INSERT/UPDATE and by the post-call processor.
app.use('/api/v1/whatsapp', whatsappWorkflowsRouter);
// Retry queue UI: list, force-retry, skip. The sweeper itself runs as a
// background worker started in index.ts.
app.use('/api/v1/whatsapp', whatsappRetryQueueRouter);
// Delivery analytics — counts by status, conversion rates, per-template.
app.use('/api/v1/whatsapp', whatsappAnalyticsRouter);
// Follow-up scheduler: auto follow-ups, visits, reminders, feedback
app.use('/api/v1/followups', followupRouter);
app.use('/api/v1/followups', followupFeaturesRouter);

app.use(errorHandler);

export { app };
