export type Kind = 'expense' | 'income';
export type OptionKind = 'bank' | 'payment_mode' | 'category' | 'income_source';
export type NeedWant = 'need' | 'want';

export interface Option {
  id: string;
  kind: OptionKind;
  name: string;
  sort_order: number;
  color: string | null;
  icon: string | null;
  archived_at: string | null;
}

export interface Transaction {
  id: string;
  kind: Kind;
  name: string;
  amount: number;
  occurred_on: string; // YYYY-MM-DD
  category_id: string | null;
  bank_id: string | null;
  payment_mode_id: string | null;
  income_source_id: string | null;
  need_want: NeedWant | null;
  notes: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at?: string;
  /** client-only flag for entries queued offline */
  pending?: boolean;
}

export interface TemplatePayload {
  name?: string;
  amount?: number | null;
  category_id?: string | null;
  bank_id?: string | null;
  payment_mode_id?: string | null;
  income_source_id?: string | null;
  need_want?: NeedWant | null;
  notes?: string | null;
}

export interface Template {
  id: string;
  kind: Kind;
  name: string;
  behavior: 'fill' | 'instant';
  payload: TemplatePayload;
  sort_order: number;
}

export interface RememberLast {
  category: boolean;
  bank: boolean;
  payment_mode: boolean;
  need_want: boolean;
  income_source: boolean;
}

export interface SheetConfig {
  spreadsheetId: string;
  tab: string;
  url?: string;
  lastSyncAt?: string | null;
  lastError?: string | null;
}

export interface Settings {
  theme_mode: 'system' | 'light' | 'dark';
  accent_hex: string;
  currency: string;
  locale: string;
  date_format: string;
  week_start: number;
  timezone: string;
  remember_last: RememberLast;
  trash_retention_days: number;
  sheet: SheetConfig | null;
}

export const DEFAULT_SETTINGS: Settings = {
  theme_mode: 'system',
  accent_hex: '#006A6A',
  currency: 'PKR',
  locale: 'en-PK',
  date_format: 'EEE, d MMM',
  week_start: 1,
  timezone: 'Asia/Karachi',
  remember_last: { category: true, bank: true, payment_mode: true, need_want: true, income_source: true },
  trash_retention_days: 30,
  sheet: null,
};
