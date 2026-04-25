import { plivoProvider } from './plivo.provider';
import { twilioProvider } from './twilio.provider';
import { exotelProvider } from './exotel.provider';
import type { TelephonyProvider } from './base.provider';

export { plivoProvider, twilioProvider, exotelProvider };

/** Resolve a provider instance by name. Defaults to twilio. */
export function getProvider(name: string): TelephonyProvider {
  switch ((name || '').toLowerCase()) {
    case 'plivo': return plivoProvider;
    case 'exotel': return exotelProvider;
    case 'twilio':
    default: return twilioProvider;
  }
}
