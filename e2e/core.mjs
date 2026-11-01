import { launch, log, sleep, sh } from './cdp.mjs';

let failures = 0;
const step = async (name, fn) => { try { await fn(); log('PASS', name); } catch (e) { failures++; log('FAIL', name, '\n', e.message); if (p?.errors?.length) log('JS errors:', p.errors.slice(0, 5).join(' | ').slice(0, 1500)); } };

let p = await launch();
let code = '';
const U = 'tester', PW = 'correct horse battery staple';

await step('first launch shows account creation', async () => {
  await p.waitFor('[data-testid=create-username]', 60000);
});
await step('create account and see recovery code', async () => {
  await p.type('[data-testid=create-username]', U);
  await p.type('[data-testid=create-password]', PW);
  await p.type('[data-testid=create-confirm]', PW);
  await sleep(300);
  await p.click('[data-testid=create-submit]');
  await p.waitFor('[data-testid=recovery-code]', 60000);
  code = (await p.inner('[data-testid=recovery-code]')).trim();
  if (!/^[0-9A-Z]{5}(-[0-9A-Z]{5}){3}$/.test(code)) throw new Error('bad recovery code format: ' + code);
});
await step('continue is gated on the checkbox', async () => {
  if (!(await p.ev(`document.querySelector('[data-testid=recovery-continue]').disabled`))) throw new Error('continue enabled before confirming');
  await p.click('[data-testid=recovery-saved]');
  await sleep(200);
  await p.click('[data-testid=recovery-continue]');
  await p.waitText('Expense', 30000);
});
await step('app shell has all four tabs', async () => {
  const t = await p.text();
  for (const w of ['Expense', 'Income', 'Insights', 'Settings']) if (!t.includes(w)) throw new Error('missing tab ' + w);
});
await step('no JS errors so far', async () => { if (p.errors.length) throw new Error(p.errors.join('\n')); });

await step('settings page renders all sections', async () => {
  await p.clickText('Settings');
  await p.waitText('Security', 20000);
  const t = await p.text();
  for (const w of ['Appearance', 'Data', 'Security', 'Account']) if (!t.includes(w)) throw new Error('missing section ' + w);
});
await step('sign out', async () => { await p.click('[data-testid=sign-out]'); await p.waitFor('[data-testid=login-username]', 20000); });
await step('wrong password rejected', async () => {
  await p.type('[data-testid=login-username]', U);
  await p.type('[data-testid=login-password]', 'definitely-wrong-password');
  await sleep(200);
  await p.click('[data-testid=login-submit]');
  await p.waitText('Wrong', 30000).catch(async () => { throw new Error('no wrong-password message: ' + (await p.text()).slice(0, 300)); });
  if (await p.exists('[data-testid=recovery-code]')) throw new Error('should not be signed in');
});
await step('correct password signs in', async () => {
  await p.type('[data-testid=login-password]', PW);
  await sleep(200);
  await p.click('[data-testid=login-submit]');
  await p.waitText('Insights', 60000);
});
p.close();

await step('data and session survive force-stop (needs sign-in again, account remembered)', async () => {
  p = await launch();
  await p.waitFor('[data-testid=login-username]', 60000);
  const u = await p.ev(`document.querySelector('[data-testid=login-username]').value`);
  if (u !== U) throw new Error('last user not remembered: ' + u);
  await p.type('[data-testid=login-password]', PW);
  await sleep(200);
  await p.click('[data-testid=login-submit]');
  await p.waitText('Insights', 60000);
});
await step('database file is not plaintext SQLite', async () => {
  const files = sh('adb shell run-as com.dailyexpenses.app find databases -type f').split('\n').filter((f) => f.endsWith('SQLite.db'));
  if (!files.length) throw new Error('no db files found: ' + sh('adb shell run-as com.dailyexpenses.app find . -type f | head -30'));
  for (const f of files) {
    const head = sh(`adb shell run-as com.dailyexpenses.app head -c 16 ${f} | od -An -c`);
    if (head.includes('S   Q   L   i   t   e')) throw new Error('plaintext header in ' + f);
  }
});
await step('no JS errors overall', async () => { if (p.errors.length) throw new Error(p.errors.join('\n')); });
await p.shot('final.png').catch(() => {});
p.close();
log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
