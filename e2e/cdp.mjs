import { execSync } from 'node:child_process';
import WebSocket from 'ws';

const sh = (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
export const log = (...a) => console.log('[e2e]', ...a);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch(pkg = 'com.dailyexpenses.app') {
  sh(`adb shell am force-stop ${pkg}`);
  sh(`adb shell monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`);
  let sock = '';
  for (let i = 0; i < 60 && !sock; i++) {
    await sleep(1000);
    const out = sh('adb shell cat /proc/net/unix').split('\n').map((l) => l.split(/\s+/).pop()).filter((n) => n && n.startsWith('@webview_devtools_remote_'));
    sock = out[0]?.slice(1) ?? '';
  }
  if (!sock) throw new Error('WebView devtools socket never appeared');
  sh(`adb forward tcp:9222 localabstract:${sock}`);
  let target;
  for (let i = 0; i < 30 && !target; i++) {
    try { const l = await (await fetch('http://127.0.0.1:9222/json')).json(); target = l.find((t) => t.type === 'page'); } catch {}
    if (!target) await sleep(1000);
  }
  if (!target) throw new Error('No page target');
  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
  let id = 0; const pend = new Map(); const errors = [];
  ws.on('message', (m) => {
    const d = JSON.parse(m);
    if (d.id && pend.has(d.id)) { const { res, rej } = pend.get(d.id); pend.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result); }
    else if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push('console.error: ' + d.params.args.map((a) => a.value ?? a.description).join(' '));
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const page = {
    ev, errors,
    close: () => ws.close(),
    exists: (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`),
    text: () => ev('document.body.innerText'),
    async waitFor(sel, ms = 30000) { const t = Date.now(); while (Date.now() - t < ms) { if (await page.exists(sel)) return; await sleep(250); } throw new Error('timeout waiting for ' + sel + '\nBODY: ' + (await page.text()).slice(0, 400)); },
    async waitText(txt, ms = 30000) { const t = Date.now(); while (Date.now() - t < ms) { if ((await page.text()).includes(txt)) return; await sleep(250); } throw new Error('timeout waiting for text "' + txt + '"\nBODY: ' + (await page.text()).slice(0, 400)); },
    click: (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)throw new Error('no ${sel.replace(/'/g, '')}');e.click();return true})()`),
    clickText: (txt) => ev(`(()=>{const e=[...document.querySelectorAll('button,a,[role=button]')].find(b=>b.innerText.trim().includes(${JSON.stringify(txt)}));if(!e)throw new Error('no button '+${JSON.stringify(txt)});e.click();return true})()`),
    type: (sel, v) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)throw new Error('no input ${sel.replace(/'/g, '')}');const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(e,${JSON.stringify(v)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`),
    attr: (sel, a) => ev(`document.querySelector(${JSON.stringify(sel)})?.getAttribute(${JSON.stringify(a)}) ?? null`),
    inner: (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ''`),
    async shot(name) { const r = await send('Page.captureScreenshot', { format: 'png' }); (await import('node:fs')).writeFileSync(name, Buffer.from(r.data, 'base64')); },
  };
  return page;
}
export { sh };
