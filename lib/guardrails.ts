// Safety rules enforced in CODE, so the AI can't skip them.
import { CONFIDENCE_THRESHOLD } from "./policy.js";

/** Replace any long digit run (full account numbers, SSNs) with ****1234. */
export function maskNumbers(text: string): string {
  return text.replace(/\b(?:\d[\d -]{6,}\d)\b/g, (m) => {
    const digits = m.replace(/\D/g, "");
    return digits.length >= 8 ? `****${digits.slice(-4)}` : m;
  });
}

/** Keep only the last 4 digits of an account number. */
export function last4Only(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

export const FILENAME_RE = /^\d{4}-(0[1-9]|1[0-2])_[A-Za-z]+-[A-Za-z]+_[A-Za-z]+_(Statement|1099|Rollover|AcctApp|RiskQ|ID|Insurance|Beneficiary|Financials|Trust|Pension|Onboarding|Other)(_\d+)?\.pdf$/;

export function clampConfidence(c: number) {
  return Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : 0;
}

export const belowThreshold = (c: number) => clampConfidence(c) < CONFIDENCE_THRESHOLD;

/** Letters only, as the naming convention requires (O'Brien -> OBrien). */
export const nameToken = (s: string) => s.replace(/[^A-Za-z]/g, "");

/**
 * Evidence check, done in code (not by the AI): may this document be filed under this person?
 * The document's own text must show the person's first AND last name, or the last 4 digits
 * of one of their accounts. Text in an email or PDF can't talk its way past this.
 */
export function documentMentions(
  text: string,
  person: { first: string; last: string; accounts: { last4: string }[] },
): { ok: boolean; why: string } {
  const words = new Set(text.toLowerCase().replace(/[’']/g, "").split(/[^a-z0-9]+/).filter(Boolean));
  const word = (w: string) => words.has(w.toLowerCase().replace(/[^a-z0-9]/g, ""));
  if (word(person.first) && word(person.last)) return { ok: true, why: `document names ${person.first} ${person.last}` };
  const acct = person.accounts.find((a) => new RegExp(`(^|\\D)${a.last4}(\\D|$)`).test(text));
  if (acct) return { ok: true, why: `document shows account ending ${acct.last4}` };
  return { ok: false, why: `the document text shows neither ${person.first} ${person.last}'s name nor any of their account numbers` };
}
