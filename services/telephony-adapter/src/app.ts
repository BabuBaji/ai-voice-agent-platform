import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { healthRouter } from './routes/health';
import { callRouter } from './routes/calls';
import { phoneNumberRouter } from './routes/phoneNumbers';
import { webhookRouter } from './routes/webhooks';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // For Twilio webhook form data
app.use(requestLogger);

// Health check
app.use('/health', healthRouter);

// Webhook routes (no auth - verified by provider signature)
app.use('/webhooks', webhookRouter);

// API routes
app.use('/api/v1/calls', callRouter);
app.use('/api/v1/phone-numbers', phoneNumberRouter);

app.use(errorHandler);

export { app };
