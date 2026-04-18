import { Router, Request, Response } from 'express';
import pino from 'pino';

const logger = pino({
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

export const webhookRouter = Router();

// Twilio voice webhook
webhookRouter.post('/twilio/voice', async (req: Request, res: Response) => {
  logger.info({ body: req.body }, 'Twilio voice webhook received');

  // Return TwiML response
  res.type('text/xml').send(`
    <?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Say>This call is being handled by the AI Voice Agent platform.</Say>
      <Pause length="1"/>
    </Response>
  `);
});

// Twilio status callback
webhookRouter.post('/twilio/status', async (req: Request, res: Response) => {
  logger.info({ body: req.body }, 'Twilio status webhook received');
  res.status(200).json({ received: true });
});

// Exotel voice webhook
webhookRouter.post('/exotel/voice', async (req: Request, res: Response) => {
  logger.info({ body: req.body }, 'Exotel voice webhook received');
  res.status(200).json({ received: true });
});

// Exotel status callback
webhookRouter.post('/exotel/status', async (req: Request, res: Response) => {
  logger.info({ body: req.body }, 'Exotel status webhook received');
  res.status(200).json({ received: true });
});
