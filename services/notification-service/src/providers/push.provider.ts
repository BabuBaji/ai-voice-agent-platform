import { config } from '../config';

/**
 * Push notification provider (Web Push / FCM).
 * Stub implementation.
 */

export interface PushOptions {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  icon?: string;
}

export class PushProvider {
  async send(options: PushOptions): Promise<{ messageId: string; status: string }> {
    console.log('PushProvider.send', {
      userId: options.userId,
      title: options.title,
    });

    // TODO: Implement web push / FCM
    // Use VAPID keys from config.push

    return {
      messageId: `push-${Date.now()}`,
      status: 'sent',
    };
  }

  async sendToTenant(tenantId: string, title: string, body: string): Promise<{ count: number; status: string }> {
    console.log('PushProvider.sendToTenant', { tenantId, title });
    return { count: 0, status: 'queued' };
  }
}

export const pushProvider = new PushProvider();
