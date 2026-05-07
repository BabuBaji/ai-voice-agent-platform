// Sandbox / synthetic number catalog. Used as a fallback when the real
// provider doesn't have a number-catalog API (Exotel) or doesn't sell in the
// requested country (Twilio in IN, Plivo in some regions). Numbers are
// deterministic-but-plausible — formatted with the country's E.164 prefix
// and a real-world local prefix, so they look like genuine PSTN numbers in
// the UI even though they're not.
//
// IMPORTANT: numbers issued from this catalog are stored with provider
// = "sandbox" in phone_numbers. The buy + KYC flows skip carrier API calls
// for sandbox numbers — they're test/demo allocations only.

interface CountrySpec {
  iso: string;
  e164: string;            // country code, e.g. "+91"
  prefixes: string[];      // common local prefixes the carrier publishes
  totalDigits: number;     // total digits including country code
  region?: string;
  monthlyRateUsd: number;
}

const COUNTRIES: CountrySpec[] = [
  // ── India ───
  { iso: 'IN', e164: '+91', prefixes: ['80487', '70488', '88806', '95004', '99999', '91123', '70123', '90099'], totalDigits: 12, region: 'India', monthlyRateUsd: 5.06 },
  // ── US ────
  { iso: 'US', e164: '+1', prefixes: ['415', '212', '305', '310', '202', '617', '312', '404', '650', '503'], totalDigits: 11, region: 'United States', monthlyRateUsd: 1.15 },
  // ── UK ────
  { iso: 'GB', e164: '+44', prefixes: ['20', '161', '121', '113', '141', '117', '151'], totalDigits: 12, region: 'United Kingdom', monthlyRateUsd: 1.50 },
  // ── Canada ───
  { iso: 'CA', e164: '+1', prefixes: ['416', '604', '514', '403', '780', '613'], totalDigits: 11, region: 'Canada', monthlyRateUsd: 1.30 },
  // ── Australia ───
  { iso: 'AU', e164: '+61', prefixes: ['2', '3', '7', '8'], totalDigits: 11, region: 'Australia', monthlyRateUsd: 6.50 },
  // ── Germany ───
  { iso: 'DE', e164: '+49', prefixes: ['30', '89', '40', '69', '221', '341'], totalDigits: 12, region: 'Germany', monthlyRateUsd: 4.00 },
  // ── France ───
  { iso: 'FR', e164: '+33', prefixes: ['1', '4', '5'], totalDigits: 11, region: 'France', monthlyRateUsd: 3.50 },
  // ── Singapore ───
  { iso: 'SG', e164: '+65', prefixes: ['6', '8', '9'], totalDigits: 10, region: 'Singapore', monthlyRateUsd: 8.00 },
  // ── UAE ────
  { iso: 'AE', e164: '+971', prefixes: ['4', '2', '6', '50', '52'], totalDigits: 12, region: 'United Arab Emirates', monthlyRateUsd: 12.00 },
  // ── Brazil ───
  { iso: 'BR', e164: '+55', prefixes: ['11', '21', '31', '41', '51'], totalDigits: 13, region: 'Brazil', monthlyRateUsd: 4.50 },
  // ── Netherlands ───
  { iso: 'NL', e164: '+31', prefixes: ['20', '10', '30', '40', '70'], totalDigits: 11, region: 'Netherlands', monthlyRateUsd: 3.20 },
  // ── Japan ───
  { iso: 'JP', e164: '+81', prefixes: ['3', '6', '11', '52'], totalDigits: 12, region: 'Japan', monthlyRateUsd: 9.00 },
];

const COUNTRY_FALLBACK: CountrySpec = {
  iso: 'XX', e164: '+1', prefixes: ['555'], totalDigits: 11, region: 'Unknown', monthlyRateUsd: 5.00,
};

export interface SandboxNumber {
  providerNumberId: string;   // synthetic ID, prefix sb_
  number: string;             // E.164 phone number
  capabilities: ('voice' | 'sms')[];
  region: string;
  country: string;
  monthlyRate: number;
  synthetic: true;            // discriminator — set to true for sandbox numbers
}

// Deterministic per (provider, country) so the same numbers show up each search
// (avoids flicker when the user hits "Search" twice). Not crypto-grade — just
// a tiny PRNG seeded by the inputs.
function seededRandom(seed: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

export function generateSandboxNumbers(opts: {
  provider: string;
  country: string;
  capabilities: ('voice' | 'sms')[];
  count?: number;
}): SandboxNumber[] {
  const country = COUNTRIES.find((c) => c.iso === opts.country.toUpperCase()) || COUNTRY_FALLBACK;
  const count = Math.min(Math.max(opts.count ?? 20, 1), 30);
  const rand = seededRandom(`${opts.provider}:${country.iso}`);

  const numbers: SandboxNumber[] = [];
  for (let i = 0; i < count; i++) {
    const prefix = country.prefixes[Math.floor(rand() * country.prefixes.length)];
    // Local digits = total - len(country code without +) - len(prefix)
    const ccDigits = country.e164.replace(/\D/g, '').length;
    const remaining = country.totalDigits - ccDigits - prefix.length;
    let local = '';
    for (let j = 0; j < remaining; j++) local += Math.floor(rand() * 10);
    const number = `${country.e164}${prefix}${local}`;
    numbers.push({
      providerNumberId: `sb_${opts.provider}_${country.iso}_${i}_${Date.now() % 100000}`,
      number,
      capabilities: opts.capabilities.length ? opts.capabilities : ['voice'],
      region: country.region || country.iso,
      country: country.iso,
      // Slight rate variance so the catalog doesn't look identical across rows
      monthlyRate: Math.round((country.monthlyRateUsd + rand() * 1.5) * 1000) / 1000,
      synthetic: true,
    });
  }
  // Dedupe (if seed collisions produce duplicates, take unique by number)
  const seen = new Set<string>();
  return numbers.filter((n) => (seen.has(n.number) ? false : (seen.add(n.number), true)));
}

export function isSandboxNumber(num: string): boolean {
  // Heuristic: nothing on the consumer side enforces this — we rely on the
  // `synthetic` discriminator at search time and the `provider="sandbox"`
  // column in phone_numbers. This helper is for explicit checks only.
  return /^sb_/.test(num);
}
