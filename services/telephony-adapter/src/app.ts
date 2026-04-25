import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { healthRouter } from './routes/health';
import { callRouter } from './routes/calls';
import { phoneNumberRouter } from './routes/phoneNumbers';
import { webhookRouter } from './routes/webhooks';
import { audioRouter } from './routes/audio';
import { recordingsRouter } from './routes/recordings';
import { campaignRouter } from './routes/campaigns';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';

const app = express();

// Relax cross-origin resource policy: the admin dashboard at localhost:5173
// fetches WAV recordings from this service via the ngrok tunnel. helmet's
// default Cross-Origin-Resource-Policy=same-origin would block that even
// with correct CORS headers.
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors());
// Accept text/csv for CSV target uploads BEFORE json/urlencoded so the raw text reaches the handler
app.use('/api/v1/campaigns/:id/targets', express.text({ type: 'text/csv', limit: '5mb' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // For Twilio webhook form data
app.use(requestLogger);

// Health check
app.use('/health', healthRouter);

// Webhook routes (no auth - verified by provider signature)
app.use('/webhooks', webhookRouter);

// Audio cache — Twilio/Plivo fetch generated MP3s from here during calls
app.use('/audio', audioRouter);
// Call recordings — WAVs written by the Plivo AudioStream handler on hangup
app.use('/recordings', recordingsRouter);

// API routes
app.use('/api/v1/calls', callRouter);
app.use('/api/v1/phone-numbers', phoneNumberRouter);
app.use('/api/v1/campaigns', campaignRouter);

app.use(errorHandler);

export { app };
