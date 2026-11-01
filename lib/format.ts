import { format, parseISO, isSameYear } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

const CURRENCY_LABEL: Record<string, string> = {
  PKR: 'Rs',
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  AED: 'AED',
  SAR: 'SAR',
};

export function currencySymbol(code: string): string {
  return CURRENCY_LABEL[code] ?? code;
}

/** `Rs 22,000` (no decimals unless the value has paise). */
export function formatMoney(value: number, currency = 'PKR', locale = 'en-PK'): string {
  const hasPaise = Math.abs(value * 100 - Math.round(value) * 100) > 0.5;
  const n = new Intl.NumberFormat(locale, {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: hasPaise ? 2 : 0,
  }).format(value);
  return `${currencySymbol(currency)} ${n}`;
}

/** Axis ticks: 12.5k, 1.2M */
export function abbreviate(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${+(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${+(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

/** `Thu, 10 Sep`, with the year when it is not the current year. */
export function formatDate(iso: string, pattern = 'EEE, d MMM', now = new Date()): string {
  const d = parseISO(iso);
  return isSameYear(d, now) ? format(d, pattern) : format(d, `${pattern} yyyy`);
}

export function todayInTz(timezone: string, now = new Date()): string {
  return formatInTimeZone(now, timezone, 'yyyy-MM-dd');
}

export function relativeDayLabel(iso: string, timezone: string, pattern: string): string {
  const today = todayInTz(timezone);
  if (iso === today) return 'Today';
  const y = new Date(parseISO(today).getTime() - 86_400_000);
  if (iso === format(y, 'yyyy-MM-dd')) return 'Yesterday';
  return formatDate(iso, pattern);
}

export function parseAmount(input: string): number {
  const n = Number(input.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function newId(): string {
  return crypto.randomUUID();
}
