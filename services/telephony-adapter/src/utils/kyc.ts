// KYC field validators. Format checks only — actual document verification
// happens upstream at the carrier (Plivo Compliance) and in human review.

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
// 14 digits or two-letter country prefix + 14 digits is GSTIN's full layout;
// Indian standard is 15 chars: 2 state + 10 PAN + 1 entity + 1 'Z' + 1 checksum.
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const PINCODE_RE = /^[1-9][0-9]{5}$/;

// Verhoeff checksum table for Aadhaar — UIDAI standard.
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export function aadhaarValid(raw: string): boolean {
  const s = (raw || '').replace(/\s/g, '');
  if (!/^\d{12}$/.test(s)) return false;
  // Reject obvious test patterns (all-same digits, sequential).
  if (/^(\d)\1{11}$/.test(s)) return false;
  let c = 0;
  const reversed = s.split('').reverse().map(Number);
  for (let i = 0; i < reversed.length; i++) {
    c = D[c][P[i % 8][reversed[i]]];
  }
  return c === 0;
}

export function panValid(raw: string): boolean {
  return PAN_RE.test((raw || '').toUpperCase().trim());
}

export function gstinValid(raw: string): boolean {
  if (!raw) return true; // GSTIN is optional
  return GSTIN_RE.test(raw.toUpperCase().trim());
}

// Cross-check the GSTIN's embedded PAN matches the supplied PAN. The 3rd-12th
// chars of a GSTIN are the entity's PAN; mismatch is a strong fraud signal.
export function gstinPanConsistent(gstin: string, pan: string): boolean {
  if (!gstin || !pan) return true;
  const g = gstin.toUpperCase().trim();
  const p = pan.toUpperCase().trim();
  if (g.length !== 15 || p.length !== 10) return false;
  return g.slice(2, 12) === p;
}

export function pincodeValid(raw: string, country: string): boolean {
  const s = (raw || '').trim();
  if (country === 'IN') return PINCODE_RE.test(s);
  return s.length >= 3 && s.length <= 12;
}

export interface KycPayload {
  business_name: string;
  owner_name: string;
  owner_email?: string;
  owner_phone?: string;
  pan?: string;
  aadhaar?: string;
  gstin?: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  use_case: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: { field: string; message: string }[];
}

export function validateKyc(input: Partial<KycPayload>, opts: { country?: string } = {}): ValidationResult {
  const errors: { field: string; message: string }[] = [];
  const country = (input.country || opts.country || 'IN').toUpperCase();

  const required = (v: any, field: string, label: string, min = 1, max = 500) => {
    const s = (v == null ? '' : String(v)).trim();
    if (s.length < min) errors.push({ field, message: `${label} is required (min ${min} chars)` });
    else if (s.length > max) errors.push({ field, message: `${label} is too long (max ${max} chars)` });
  };

  required(input.business_name, 'business_name', 'Business name', 2, 200);
  required(input.owner_name, 'owner_name', 'Owner name', 2, 200);
  required(input.address_line1, 'address_line1', 'Address line 1', 5, 255);
  required(input.city, 'city', 'City', 2, 100);
  required(input.state, 'state', 'State', 2, 100);
  required(input.postal_code, 'postal_code', 'Postal code', 3, 20);
  required(input.use_case, 'use_case', 'Use case', 20, 1000);

  if (input.owner_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.owner_email)) {
    errors.push({ field: 'owner_email', message: 'Invalid email format' });
  }
  if (input.owner_phone && !/^\+?[1-9]\d{7,14}$/.test(input.owner_phone.replace(/[\s-]/g, ''))) {
    errors.push({ field: 'owner_phone', message: 'Phone must be E.164 format' });
  }

  if (input.postal_code && !pincodeValid(input.postal_code, country)) {
    errors.push({ field: 'postal_code', message: country === 'IN' ? 'Indian PIN must be 6 digits' : 'Invalid postal code' });
  }

  // For India: PAN is mandatory, Aadhaar must be valid Verhoeff if supplied,
  // GSTIN if supplied must be consistent with the PAN.
  if (country === 'IN') {
    if (!input.pan) errors.push({ field: 'pan', message: 'PAN is required for Indian KYC' });
    else if (!panValid(input.pan)) errors.push({ field: 'pan', message: 'PAN must match AAAAA9999A format' });

    if (input.aadhaar && !aadhaarValid(input.aadhaar)) {
      errors.push({ field: 'aadhaar', message: 'Aadhaar checksum failed — verify the 12-digit number' });
    }

    if (input.gstin) {
      if (!gstinValid(input.gstin)) errors.push({ field: 'gstin', message: 'GSTIN must be 15 chars (state+PAN+entity+Z+checksum)' });
      else if (input.pan && !gstinPanConsistent(input.gstin, input.pan)) {
        errors.push({ field: 'gstin', message: 'GSTIN PAN segment does not match the supplied PAN' });
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

export function aadhaarLast4(raw?: string): string | null {
  if (!raw) return null;
  const s = raw.replace(/\s/g, '');
  return /^\d{12}$/.test(s) ? s.slice(-4) : null;
}
