'use client';
import { exportCsv, type ExportFilter } from '@/core/csv';
import { getDb } from '@/lib/local/runtime';
import { saveAndShare } from '@/lib/local/platform';

export async function exportRange(from?: string, to?: string, kind?: 'expense' | 'income'): Promise<void> {
  const f: ExportFilter = { from, to, kind };
  const csv = await exportCsv(getDb(), f);
  const day = new Date().toISOString().slice(0, 10);
  await saveAndShare({ filename: `daily-expenses-${day}.csv`, data: '﻿' + csv, dialogTitle: 'Export entries (CSV)' });
}
