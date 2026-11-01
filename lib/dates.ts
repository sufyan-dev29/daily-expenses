import {
  addDays,
  addMonths,
  addYears,
  differenceInCalendarDays,
  endOfMonth,
  endOfYear,
  format,
  parseISO,
  startOfMonth,
  startOfYear,
  subDays,
} from 'date-fns';

export type Gran = 'day' | 'week' | 'month' | 'year';
export type Preset =
  | 'this_week' | 'last_week' | 'this_month' | 'last_month'
  | 'last_3m' | 'last_6m' | 'last_12m' | 'this_year' | 'last_year' | 'all' | 'custom';

export const PRESET_LABELS: Record<Preset, string> = {
  this_week: 'This week',
  last_week: 'Last week',
  this_month: 'This month',
  last_month: 'Last month',
  last_3m: 'Last 3 months',
  last_6m: 'Last 6 months',
  last_12m: 'Last 12 months',
  this_year: 'This year',
  last_year: 'Last year',
  all: 'All time',
  custom: 'Custom',
};

const iso = (d: Date) => format(d, 'yyyy-MM-dd');

/** Start of the week containing d. weekStart: 1 = Monday ... 7 = Sunday (ISO). */
export function startOfWeekIso(d: Date, weekStart = 1): Date {
  const isoDow = d.getDay() === 0 ? 7 : d.getDay();
  const diff = (isoDow - weekStart + 7) % 7;
  return subDays(d, diff);
}

/** Resolves a preset into an inclusive [from, to] pair (YYYY-MM-DD) in the user's "today". */
export function presetRange(preset: Preset, today: string, weekStart = 1): { from: string; to: string } {
  const t = parseISO(today);
  switch (preset) {
    case 'this_week': {
      const s = startOfWeekIso(t, weekStart);
      return { from: iso(s), to: iso(addDays(s, 6)) };
    }
    case 'last_week': {
      const s = subDays(startOfWeekIso(t, weekStart), 7);
      return { from: iso(s), to: iso(addDays(s, 6)) };
    }
    case 'this_month':
      return { from: iso(startOfMonth(t)), to: iso(endOfMonth(t)) };
    case 'last_month': {
      const m = addMonths(t, -1);
      return { from: iso(startOfMonth(m)), to: iso(endOfMonth(m)) };
    }
    case 'last_3m':
      return { from: iso(startOfMonth(addMonths(t, -2))), to: iso(endOfMonth(t)) };
    case 'last_6m':
      return { from: iso(startOfMonth(addMonths(t, -5))), to: iso(endOfMonth(t)) };
    case 'last_12m':
      return { from: iso(startOfMonth(addMonths(t, -11))), to: iso(endOfMonth(t)) };
    case 'this_year':
      return { from: iso(startOfYear(t)), to: iso(endOfYear(t)) };
    case 'last_year': {
      const y = addYears(t, -1);
      return { from: iso(startOfYear(y)), to: iso(endOfYear(y)) };
    }
    case 'all':
      return { from: '2000-01-01', to: '2100-12-31' };
    default:
      return { from: iso(startOfMonth(t)), to: iso(endOfMonth(t)) };
  }
}

/** The equal-length window immediately before [from, to]. */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const f = parseISO(from);
  const len = differenceInCalendarDays(parseISO(to), f) + 1;
  return { from: iso(subDays(f, len)), to: iso(subDays(f, 1)) };
}

/** ISO 8601 week number (Monday-based). Only meaningful when weekStart is 1. */
export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

export function bucketLabel(bucketIso: string, gran: Gran): string {
  const d = parseISO(bucketIso);
  switch (gran) {
    case 'day': return format(d, 'd MMM');
    case 'week': return `W${isoWeek(d)} · ${format(d, 'd MMM')}`;
    case 'month': return format(d, 'MMM yy');
    case 'year': return format(d, 'yyyy');
  }
}
