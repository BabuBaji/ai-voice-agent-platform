import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import pino from 'pino';
import { config } from '../config';

const logger = pino({
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

interface MediaStreamSession {
  callSid: string;
  conversationId: string;
  agentId: string;
  tenantId: string;
  streamSid: string | null;
  voiceWs: WebSocket | null;
}

// Active media stream sessions
const sessions = new Map<WebSocket, MediaStreamSession>();

export function setupWebSocketServer(server: http.Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/media-stream' });

  wss.on('connection', (ws: WebSocket, req) => {
    const url = new URL(req.url || '', 'http://localhost');
    const callSid = url.searchParams.get('callSid') || '';
    const conversationId = url.searchParams.get('conversationId') || '';
    const agentId = url.searchParams.get('agentId') || '';
    const tenantId = url.searchParams.get('tenantId') || '';

    const session: MediaStreamSession = {
      callSid,
      conversationId,
      agentId,
      tenantId,
      streamSid: null,
      voiceWs: null,
    };

    sessions.set(ws, session);
    logger.info({ callSid, conversationId, agentId }, 'Media stream WebSocket connected');

    // Connect to voice-service WebSocket for audio processing
    connectToVoiceService(ws, session);

    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        handleTwilioMediaMessage(ws, session, message);
      } catch (err) {
        // Binary audio data - should not happen with Twilio media streams (they send JSON)
        logger.debug({ callSid: session.callSid, size: data.length }, 'Received raw binary data');
      }
    });

    ws.on('close', (code, reason) => {
      logger.info({ callSid: session.callSid, code, reason: reason?.toString() }, 'Media stream WebSocket closed');
      // Clean up voice service connection
      if (session.voiceWs && session.voiceWs.readyState === WebSocket.OPEN) {
        session.voiceWs.close();
      }
      sessions.delete(ws);
    });

    ws.on('error', (err) => {
      logger.error({ callSid: session.callSid, err: err.message }, 'Media stream WebSocket error');
    });
  });

  logger.info('WebSocket media stream server attached');
  return wss;
}

/**
 * Handle Twilio Media Streams protocol messages.
 * Events: connected, start, media, stop
 */
function handleTwilioMediaMessage(
  ws: WebSocket,
  session: MediaStreamSession,
  message: { event: string; streamSid?: string; media?: { payload: string; chunk?: string; timestamp?: string }; start?: { streamSid: string; callSid: string; customParameters?: Record<string, string> }; stop?: { callSid: string } }
): void {
  switch (message.event) {
    case 'connected':
      logger.info({ callSid: session.callSid }, 'Twilio media stream connected');
      break;

    case 'start':
      session.streamSid = message.start?.streamSid || message.streamSid || null;
      logger.info(
        { callSid: session.callSid, streamSid: session.streamSid },
        'Twilio media stream started'
      );
      break;

    case 'media':
      // Forward audio payload to voice-service
      if (session.voiceWs && session.voiceWs.readyState === WebSocket.OPEN && message.media?.payload) {
        // The payload is base64-encoded mulaw audio
        const audioBuffer = Buffer.from(message.media.payload, 'base64');
        session.voiceWs.send(JSON.stringify({
          type: 'audio_in',
          callSid: session.callSid,
          conversationId: session.conversationId,
          agentId: session.agentId,
          tenantId: session.tenantId,
          audio: message.media.payload, // Keep base64 for transport
          format: 'mulaw',
          sampleRate: 8000,
          timestamp: message.media.timestamp,
        }));
      }
      break;

    case 'stop':
      logger.info({ callSid: session.callSid }, 'Twilio media stream stopped');
      // Clean up
      if (session.voiceWs && session.voiceWs.readyState === WebSocket.OPEN) {
        session.voiceWs.send(JSON.stringify({
          type: 'stream_ended',
          callSid: session.callSid,
          conversationId: session.conversationId,
        }));
      }
      break;

    default:
      logger.debug({ event: message.event, callSid: session.callSid }, 'Unknown media stream event');
  }
}

/**
 * Connect to the voice-service WebSocket to send/receive audio.
 */
function connectToVoiceService(twilioWs: WebSocket, session: MediaStreamSession): void {
  const voiceWsUrl = config.voiceServiceUrl.replace(/^http/, 'ws');
  const wsUrl = `${voiceWsUrl}/ws/audio?callSid=${session.callSid}&conversationId=${session.conversationId}&agentId=${session.agentId}&tenantId=${session.tenantId}`;

  try {
    const voiceWs = new WebSocket(wsUrl);

    voiceWs.on('open', () => {
      logger.info({ callSid: session.callSid }, 'Connected to voice-service WebSocket');
      session.voiceWs = voiceWs;
    });

    voiceWs.on('message', (data: Buffer) => {
      // Receive processed audio from voice-service and send back to Twilio
      try {
        const message = JSON.parse(data.toString());

        if (message.type === 'audio_out' && message.audio && session.streamSid) {
          // Send audio back to Twilio via the media stream
          const mediaMessage = {
            event: 'media',
            streamSid: session.streamSid,
            media: {
              payload: message.audio, // base64-encoded mulaw audio
            },
          };
          if (twilioWs.readyState === WebSocket.OPEN) {
            twilioWs.send(JSON.stringify(mediaMessage));
          }
        } else if (message.type === 'clear') {
          // Clear the audio buffer on Twilio side
          if (twilioWs.readyState === WebSocket.OPEN && session.streamSid) {
            twilioWs.send(JSON.stringify({
              event: 'clear',
              streamSid: session.streamSid,
            }));
          }
        }
      } catch (err) {
        // Binary audio data from voice service
        logger.debug({ callSid: session.callSid, size: data.length }, 'Received binary from voice service');
      }
    });

    voiceWs.on('close', () => {
      logger.info({ callSid: session.callSid }, 'Voice-service WebSocket closed');
      session.voiceWs = null;
    });

    voiceWs.on('error', (err) => {
      logger.error({ callSid: session.callSid, err: err.message }, 'Voice-service WebSocket error');
      session.voiceWs = null;
    });
  } catch (err: any) {
    logger.error({ callSid: session.callSid, err: err.message }, 'Failed to connect to voice-service WebSocket');
  }
}
