/** Money helpers. Amounts live in the database as integer minor units (paisa/cents). */

export function toMinor(amount: number): number {
  if (!Number.isFinite(amount)) throw new Error('Invalid amount');
  return Math.round(amount * 100);
}

export function fromMinor(minor: number): number {
  return minor / 100;
}

/**
 * Parses a user or CSV amount such as "1,234.50", "Rs 1 200", "PKR 5,000", "(250)" or "1.234,50".
 * Returns null when it is not a usable positive number.
 */
export function parseAmount(raw: string | number | null | undefined): number | null {
  const n = parseAmountSigned(raw);
  return n !== null && n > 0 ? n : null;
}

/** Like parseAmount but keeps the sign: "-250", "(250)" give -250. Zero and non-numbers give null. */
export function parseAmountSigned(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw !== 0 ? raw : null;
  let s = raw.trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s) || s.startsWith('-');
  s = s.replace(/[^\d.,]/g, '');
  if (!s || !/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // The later separator is the decimal one.
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const commas = s.split(',').length - 1;
    const after = s.length - lastComma - 1;
    // Several commas are thousands separators. A single comma is thousands when exactly 3 digits follow ("1,234"), otherwise a decimal comma ("12,5").
    if (commas > 1 || after === 3) s = s.replace(/,/g, '');
    else s = s.replace(',', '.');
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n === 0) return null;
  return negative ? -n : n;
}
