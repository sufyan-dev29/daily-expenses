import { NextResponse } from 'next/server';
import { requireUser, unauthorized } from '@/lib/guards';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const esc = (v: unknown) => {
  const s = String(v ?? '');
  // neutralise spreadsheet formula injection
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** CSV of all (non-trashed) entries. Optional ?from=&to=&kind= filters. */
export async function GET(req: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return unauthorized();
  const sp = new URL(req.url).searchParams;

  let query = supabase
    .from('transactions')
    .select(
      'occurred_on,name,amount,kind,need_want,notes,id,category:options!transactions_category_id_fkey(name),bank:options!transactions_bank_id_fkey(name),mode:options!transactions_payment_mode_id_fkey(name),source:options!transactions_income_source_id_fkey(name)',
    )
    .is('deleted_at', null)
    .order('occurred_on')
    .limit(50_000);
  if (sp.get('from')) query = query.gte('occurred_on', sp.get('from')!);
  if (sp.get('to')) query = query.lte('occurred_on', sp.get('to')!);
  if (sp.get('kind') === 'expense' || sp.get('kind') === 'income') query = query.eq('kind', sp.get('kind')!);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const head = ['Date', 'Description', 'Category', 'Amount', 'Payment Mode', 'Bank Name', 'Type', 'Notes', 'Entry', 'ID'];
  const lines = [head.join(',')];
  for (const r of (data ?? []) as unknown as Array<Record<string, any>>) {
    lines.push(
      [
        r.occurred_on,
        r.name,
        r.kind === 'income' ? r.source?.name : r.category?.name,
        r.amount,
        r.mode?.name,
        r.bank?.name,
        r.need_want ? (r.need_want === 'need' ? 'Need' : 'Want') : '',
        r.notes,
        r.kind === 'income' ? 'Income' : 'Expense',
        r.id,
      ]
        .map(esc)
        .join(','),
    );
  }
  return new NextResponse(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="expenses-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
