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
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';

const app = express();

app.use(helmet());
app.use(cors());

// Recording upload/serve router must be mounted BEFORE express.json()
// so the raw audio body isn't parsed as JSON.
app.use('/api/v1', recordingRouter);

app.use(express.json({ limit: '10mb' }));
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

app.use(errorHandler);

export { app };
