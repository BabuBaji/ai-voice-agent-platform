import { config } from '../config';

/**
 * WhatsApp notification provider.
 * Stub implementation.
 */

export interface WhatsAppOptions {
  to: string;
  templateName: string;
  templateParams: Record<string, string>;
  language?: string;
}

export class WhatsAppProvider {
  async send(options: WhatsAppOptions): Promise<{ messageId: string; status: string }> {
    console.log('WhatsAppProvider.send', {
      to: options.to,
      templateName: options.templateName,
    });

    // TODO: Use WhatsApp Business API
    // await fetch(config.whatsapp.apiUrl, { ... });

    return {
      messageId: `wa-${Date.now()}`,
      status: 'sent',
    };
  }
}

export const whatsappProvider = new WhatsAppProvider();
