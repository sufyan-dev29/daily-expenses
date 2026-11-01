export interface InsightsData {
  totals: { spent: number; income: number; count: number; expense_count: number; biggest: { name: string; amount: number } | null };
  series: { bucket: string; expense: number; income: number; count: number }[];
  monthly: { bucket: string; expense: number; income: number }[];
  by_category: { id: string | null; name: string; color: string | null; total: number; count: number }[];
  by_source: { id: string | null; name: string; color: string | null; total: number; count: number }[];
  by_bank: { id: string | null; name: string; expense: number; income: number }[];
  by_mode: { id: string | null; name: string; expense: number; income: number }[];
  need_want: { key: 'need' | 'want' | 'unspecified'; total: number; count: number }[];
  nw_series: { bucket: string; need: number; want: number; unspecified: number }[];
  top: { id: string; name: string; amount: number; occurred_on: string; category: string | null }[];
  daily: { day: string; total: number }[];
  dow: { dow: number; total: number; days: number }[];
}

export interface Filters {
  preset: string;
  from: string;
  to: string;
  gran: 'day' | 'week' | 'month' | 'year';
  kind: '' | 'expense' | 'income';
  category: string;
  bank: string;
  mode: string;
  nw: '' | 'need' | 'want';
  source: string;
  min: string;
  max: string;
  q: string;
  cmp: '0' | '1';
  overlay: '0' | '1';
}
