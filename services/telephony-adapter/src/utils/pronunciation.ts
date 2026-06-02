/**
 * Deterministic pronunciation normalization for TTS output.
 *
 * The voice-agent prompt already ASKS the LLM to spell acronyms (SRM → "S R M")
 * and pronounce names clearly, but model compliance is probabilistic — on some
 * turns it emits "SRM University" verbatim and the TTS engine reads it as a
 * single garbled word ("srrm"). This module applies a guaranteed,
 * model-independent pass over the TTS text right before synthesis so college
 * acronyms are always spelled out and known tricky names get a phonetic form.
 *
 * Design constraints (kept deliberately narrow so we never mangle good text):
 *  - ASCII-only operation. Telugu / Hindi / Tamil / etc. script is left
 *    untouched (the LLM already produces correctly-spelled Indic acronyms when
 *    speaking those languages, and Sarvam's enable_preprocessing handles them).
 *  - Never touch tokens that look like emails, URLs, numbers, or already-spaced
 *    letters — those have their own read-back handling in the prompt/decoder.
 *  - Pure function, no side effects, no deps — trivially unit-testable.
 */

/**
 * Explicit name/term → spoken-form overrides. Seeded with a few known-tricky
 * admissions names; extend freely. Keys are matched case-insensitively as whole
 * words. Values are the literal text handed to the TTS engine.
 *
 * NOTE: these apply to LATIN-script spellings only. When the agent speaks
 * Telugu/Hindi the name is already in native script and won't match here.
 */
export const PRONUNCIATION_OVERRIDES: Record<string, string> = {
  bajibabu: 'Baaji Babu',
  baajibabu: 'Baaji Babu',
};

/**
 * Acronyms / initialisms that must be spelled letter-by-letter. We also have a
 * generic all-caps speller below, but this explicit set guarantees the common
 * college/board acronyms even when they happen to look pronounceable.
 */
const FORCE_SPELL = new Set([
  'SRM', 'SRMAP', 'JNTUH', 'JNTU', 'JNTUK', 'JNTUA', 'KL', 'KLEF', 'VIT', 'VITAP',
  'CBIT', 'BITS', 'NIT', 'IIT', 'IIIT', 'NITW', 'GITAM', 'SVU', 'OU', 'AU', 'ANU',
  'KLU', 'MRU', 'MGIT', 'VNR', 'CVR', 'BVRIT', 'GRIET', 'VVIT', 'SNIST',
  'EAMCET', 'EAPCET', 'ECET', 'ICET', 'NEET', 'JEE', 'GATE',
  'CSE', 'AIML', 'ECE', 'EEE', 'MEC', 'CEC', 'MPC', 'BIPC',
  'MBA', 'MCA', 'BCA', 'BBA', 'MBBS', 'BDS',
]);

/**
 * Common all-caps words that are NOT acronyms and must stay as words. Without
 * this allowlist the generic speller would turn "OK" into "O K".
 */
const NOT_ACRONYM = new Set([
  'OK', 'OKAY', 'TV', 'AM', 'PM', 'AC', 'ID', 'NO', 'YES', 'HI', 'OR', 'AND',
  'A', 'I', 'IN', 'IT', 'IS', 'AT', 'TO', 'UP', 'GO', 'US', 'WE', 'BE', 'DO',
  'INR', 'USD', 'EMI',
]);

/** Spell a token into spaced upper-case letters: "SRM" → "S R M". */
function spellOut(token: string): string {
  return token.toUpperCase().split('').join(' ');
}

/**
 * Native-script letter names so an Indic TTS engine (Sarvam bulbul:v2) speaks
 * an acronym clearly. On a Telugu call, the Latin spaced form "S R M" is read
 * as a garbled English blur; the Telugu letters "ఎస్ ఆర్ ఎం" are read crisply.
 */
const INDIC_LETTER_NAMES: Record<string, Record<string, string>> = {
  te: {
    A: 'ఏ', B: 'బీ', C: 'సీ', D: 'డీ', E: 'ఈ', F: 'ఎఫ్', G: 'జీ', H: 'హెచ్',
    I: 'ఐ', J: 'జే', K: 'కే', L: 'ఎల్', M: 'ఎం', N: 'ఎన్', O: 'ఓ', P: 'పీ',
    Q: 'క్యూ', R: 'ఆర్', S: 'ఎస్', T: 'టీ', U: 'యూ', V: 'వీ', W: 'డబ్ల్యూ',
    X: 'ఎక్స్', Y: 'వై', Z: 'జెడ్',
  },
  hi: {
    A: 'ए', B: 'बी', C: 'सी', D: 'डी', E: 'ई', F: 'एफ', G: 'जी', H: 'एच',
    I: 'आई', J: 'जे', K: 'के', L: 'एल', M: 'एम', N: 'एन', O: 'ओ', P: 'पी',
    Q: 'क्यू', R: 'आर', S: 'एस', T: 'टी', U: 'यू', V: 'वी', W: 'डब्ल्यू',
    X: 'एक्स', Y: 'वाई', Z: 'ज़ेड',
  },
};

/** Whole-acronym native words that are spoken as a word, not letter-by-letter. */
const INDIC_ACRONYM_WORDS: Record<string, Record<string, string>> = {
  te: { EAMCET: 'ఎంసెట్', EAPCET: 'ఎప్ సెట్', NEET: 'నీట్', GATE: 'గేట్' },
  hi: { EAMCET: 'एमसेट', NEET: 'नीट', GATE: 'गेट' },
};

/** Spell a token in the call's script when Indic, else Latin spaced form. */
function spellOutForLang(token: string, language?: string | null): string {
  const lang2 = String(language || '').toLowerCase().slice(0, 2);
  const up = token.toUpperCase();
  const words = INDIC_ACRONYM_WORDS[lang2];
  if (words && words[up]) return words[up];
  const letters = INDIC_LETTER_NAMES[lang2];
  if (letters) {
    const mapped = up.split('').map((ch) => letters[ch] || ch);
    return mapped.join(' ');
  }
  return spellOut(token);
}

/**
 * Normalize a sanitized reply string for clearer TTS pronunciation.
 *
 * @param text     The TTS-bound reply (already run through sanitizeForTts).
 * @param language BCP-47-ish language code (e.g. "en-IN", "te-IN"). Currently
 *                 only used as a guard hook; normalization itself is
 *                 script-based, not language-based, so it is safe for all.
 */
export function normalizePronunciation(text: string, _language?: string | null): string {
  if (!text) return text;

  // Collapse dotted abbreviations written in Indic script ("సి.ఎస్.ఈ." →
  // "సిఎస్ఈ"). A period BETWEEN two Indic letters (no space) is never a
  // sentence boundary — it's an abbreviation, and the dots make Sarvam's TTS
  // stutter/break. Safe: real sentence ends have a space or end-of-string after
  // the period, so they don't match the lookahead.
  text = text.replace(/([ऀ-෿])\.(?=[ऀ-෿])/gu, '$1');

  // Split on whitespace but KEEP the whitespace so we can rejoin verbatim and
  // not collapse intentional spacing.
  const parts = text.split(/(\s+)/);

  for (let i = 0; i < parts.length; i++) {
    const tok = parts[i];
    if (!tok || /^\s+$/.test(tok)) continue;

    // Peel leading/trailing punctuation so "SRM," or "(JNTUH)" still match;
    // the punctuation is re-attached afterwards.
    const m = tok.match(/^([^A-Za-z0-9]*)([A-Za-z0-9.@_+-]*?)([^A-Za-z0-9]*)$/);
    if (!m) continue;
    const [, lead, core, trail] = m;
    if (!core) continue;

    // Never touch emails / URLs / numbers / decimals / already-spaced letters.
    if (/[@]/.test(core)) continue;            // email / handle
    if (/\d/.test(core)) continue;             // contains a digit (phone, marks, fees)
    if (core.includes('.')) continue;          // domain / abbreviation with dots

    const lower = core.toLowerCase();

    // 1. Explicit phonetic override (whole-word, case-insensitive).
    if (PRONUNCIATION_OVERRIDES[lower]) {
      parts[i] = lead + PRONUNCIATION_OVERRIDES[lower] + trail;
      continue;
    }

    // 2. Force-spell known acronyms (case-insensitive match on the bare core).
    //    On an Indic call these are spelled in the call's own script so the
    //    Indic TTS says them crisply ("SRM" → "ఎస్ ఆర్ ఎం"); on English calls
    //    they stay the Latin spaced form ("S R M").
    if (FORCE_SPELL.has(core.toUpperCase())) {
      parts[i] = lead + spellOutForLang(core, _language) + trail;
      continue;
    }

    // 3. Generic all-caps initialism: 2–6 uppercase letters that aren't a known
    //    real word. Requires the ORIGINAL token to be all-caps (so "Srm" typed
    //    in mixed case is left alone — only shouted acronyms are spelled).
    if (/^[A-Z]{2,6}$/.test(core) && !NOT_ACRONYM.has(core)) {
      parts[i] = lead + spellOutForLang(core, _language) + trail;
      continue;
    }
  }

  return parts.join('');
}
