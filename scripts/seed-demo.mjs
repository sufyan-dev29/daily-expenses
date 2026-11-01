// Demo data for testing Insights. Run: npm run seed:demo   (needs .env.local)
// Adds ~2 years of realistic entries for the owner account. Entries are tagged with the note "demo-seed"
// so they can be removed:  npm run seed:demo -- --clear
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !svc) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
const admin = createClient(url, svc, { auth: { persistSession: false } });

const { data: profile } = await admin.from('profiles').select('id').limit(1).maybeSingle();
if (!profile) throw new Error('No owner account yet. Finish /setup first.');
const uid = profile.id;

if (process.argv.includes('--clear')) {
  const { count } = await admin.from('transactions').delete({ count: 'exact' }).eq('user_id', uid).eq('notes', 'demo-seed');
  console.log(`Removed ${count} demo entries.`);
  process.exit(0);
}

const { data: opts } = await admin.from('options').select('id,kind,name').eq('user_id', uid).is('archived_at', null);
const by = (k) => (opts ?? []).filter((o) => o.kind === k);
if (!by('category').length) throw new Error('No categories found. Add some in Settings (or enable starter lists in setup).');

const rnd = (a, b) => Math.round(a + Math.random() * (b - a));
const pick = (arr) => (arr.length ? arr[Math.floor(Math.random() * arr.length)].id : null);
const iso = (d) => d.toISOString().slice(0, 10);
const rows = [];
const end = new Date();
for (let d = new Date(end.getTime() - 730 * 86_400_000); d <= end; d = new Date(d.getTime() + 86_400_000)) {
  const n = Math.random() < 0.7 ? rnd(1, 3) : 0;
  for (let i = 0; i < n; i++) {
    const want = Math.random() < 0.35;
    rows.push({
      user_id: uid, kind: 'expense', name: want ? 'Dining out' : ['Groceries', 'Fuel', 'Utility bill', 'Pharmacy', 'Rickshaw'][rnd(0, 4)],
      amount: want ? rnd(800, 6000) : rnd(150, 9000), occurred_on: iso(d), category_id: pick(by('category')),
      bank_id: pick(by('bank')), payment_mode_id: pick(by('payment_mode')), need_want: want ? 'want' : 'need', notes: 'demo-seed',
    });
  }
  if (d.getDate() === 1) {
    rows.push({ user_id: uid, kind: 'income', name: 'Salary', amount: rnd(180000, 230000), occurred_on: iso(d), income_source_id: pick(by('income_source')), bank_id: pick(by('bank')), notes: 'demo-seed' });
  }
}
for (let i = 0; i < rows.length; i += 500) {
  const { error } = await admin.from('transactions').insert(rows.slice(i, i + 500));
  if (error) throw error;
}
console.log(`Inserted ${rows.length} demo entries. Remove them with: npm run seed:demo -- --clear`);
