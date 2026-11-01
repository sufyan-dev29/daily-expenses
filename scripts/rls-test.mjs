// Two-user RLS test. Run: npm run test:rls   (needs .env.local with the Supabase keys)
// Creates two throwaway users, proves user A can never read or write user B's rows, then deletes them.
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anon || !svc) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY');

const admin = createClient(url, svc, { auth: { persistSession: false } });
const stamp = Date.now();
const mk = async (n) => {
  const email = `rls-${n}-${stamp}@example.test`;
  const password = `Test-${stamp}-${n}-pw!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, anon, { auth: { persistSession: false } });
  const { error: e2 } = await client.auth.signInWithPassword({ email, password });
  if (e2) throw e2;
  return { id: data.user.id, client };
};

let failed = 0;
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; };

const A = await mk('a');
const B = await mk('b');
try {
  await admin.from('user_settings').insert([{ user_id: A.id }, { user_id: B.id }]);
  const { data: opt } = await B.client.from('options').insert({ kind: 'category', name: 'Secret' }).select('id').single();
  const { data: tx } = await B.client
    .from('transactions')
    .insert({ kind: 'expense', name: 'B private', amount: 123, occurred_on: '2026-01-01' })
    .select('id')
    .single();
  check('B can write own rows', !!tx && !!opt);

  const read = await A.client.from('transactions').select('id').eq('id', tx.id);
  check('A cannot read B transactions', (read.data ?? []).length === 0);
  const readOpt = await A.client.from('options').select('id').eq('id', opt.id);
  check('A cannot read B options', (readOpt.data ?? []).length === 0);

  const upd = await A.client.from('transactions').update({ name: 'hacked' }).eq('id', tx.id).select('id');
  check('A cannot update B transactions', (upd.data ?? []).length === 0);
  const del = await A.client.from('transactions').delete().eq('id', tx.id).select('id');
  check('A cannot delete B transactions', (del.data ?? []).length === 0);

  const forge = await A.client.from('transactions').insert({ user_id: B.id, kind: 'expense', name: 'forged', amount: 1, occurred_on: '2026-01-01' });
  check('A cannot insert rows as B', !!forge.error);

  const sec = await A.client.from('secrets').select('*');
  check('secrets table is unreadable to users', (sec.data ?? []).length === 0);
  await admin.from('secrets').insert({ user_id: B.id, key: 'smtp', ciphertext: 'x' });
  const sec2 = await B.client.from('secrets').select('*');
  check('even the owner cannot read secrets from the browser', (sec2.data ?? []).length === 0);

  const ins = await A.client.rpc('insights', { p_from: '2026-01-01', p_to: '2026-12-31' });
  check('insights() for A does not include B data', ins.data?.totals?.spent === 0);

  const anonClient = createClient(url, anon, { auth: { persistSession: false } });
  const anonRead = await anonClient.from('transactions').select('id').limit(1);
  check('anonymous visitors read nothing', (anonRead.data ?? []).length === 0);
} finally {
  await admin.auth.admin.deleteUser(A.id);
  await admin.auth.admin.deleteUser(B.id);
}
console.log(failed ? `\n${failed} check(s) FAILED. Do not go live.` : '\nAll RLS checks passed.');
process.exit(failed ? 1 : 0);
