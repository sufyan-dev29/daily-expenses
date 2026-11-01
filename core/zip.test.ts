import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, unzip, zip, ZipError } from './zip.ts';
import { concat, utf8 } from './bytes.ts';

const dir = mkdtempSync(join(tmpdir(), 'zip-'));
const py = (code: string, ...args: string[]) => execFileSync('python3', ['-I', '-c', code, ...args], { encoding: 'utf8' });

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(utf8('123456789')), 0xcbf43926);
});

test('round trip in memory, compressible and incompressible data, empty file', async () => {
  const noise = new Uint8Array(5000).map((_, i) => (i * 7919 + 13) % 251);
  const files = [{ name: 'manifest.json', data: utf8('{"a":1}'.repeat(2000)) }, { name: 'noise.bin', data: noise }, { name: 'empty.txt', data: new Uint8Array(0) }];
  const back = await unzip(await zip(files));
  assert.deepEqual(back.map((f) => f.name), files.map((f) => f.name));
  for (let i = 0; i < files.length; i++) assert.deepEqual(back[i].data, files[i].data);
});

test('archives we write are valid for unzip and Python', async () => {
  const data = utf8(JSON.stringify({ hello: 'wörld ✓', rows: Array.from({ length: 500 }, (_, i) => i) }));
  const file = join(dir, 'ours.zip');
  writeFileSync(file, await zip([{ name: 'manifest.json', data }]));
  execFileSync('unzip', ['-tq', file]);
  const got = py('import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(z.read("manifest.json").decode(), end="")', file);
  assert.equal(got, new TextDecoder().decode(data));
});

test('archives made by other tools open (deflate and stored)', async () => {
  const file = join(dir, 'theirs.zip');
  py(`import zipfile,sys
with zipfile.ZipFile(sys.argv[1],'w') as z:
    z.writestr(zipfile.ZipInfo('manifest.json'), 'x'*100000, compress_type=zipfile.ZIP_DEFLATED)
    z.writestr(zipfile.ZipInfo('plain.txt'), 'hello', compress_type=zipfile.ZIP_STORED)`, file);
  const back = await unzip(new Uint8Array(readFileSync(file)));
  assert.equal(back[0].data.length, 100000);
  assert.equal(new TextDecoder().decode(back[1].data), 'hello');
});

test('rejects: not a zip, truncated, bit-flipped, path traversal, absolute and backslash names, encrypted flag', async () => {
  const good = await zip([{ name: 'manifest.json', data: utf8('hello'.repeat(500)) }]);
  await assert.rejects(() => unzip(utf8('this is definitely not a zip file at all')), ZipError);
  await assert.rejects(() => unzip(good.slice(0, good.length - 30)), ZipError);
  const flipped = good.slice(); flipped[40] ^= 0xff;
  await assert.rejects(() => unzip(flipped), ZipError);
  for (const bad of ['../evil.txt', 'a/../../evil', '/etc/passwd', 'C:\\x', 'dir\\file']) {
    const f = join(dir, 'bad.zip');
    py(`import zipfile,sys
with zipfile.ZipFile(sys.argv[1],'w') as z:
    z.writestr(zipfile.ZipInfo(sys.argv[2]), 'x')`, f, bad);
    await assert.rejects(() => unzip(new Uint8Array(readFileSync(f))), ZipError, bad);
  }
  const enc = good.slice();
  const dv = new DataView(enc.buffer);
  const cd = dv.getUint32(enc.length - 22 + 16, true);
  dv.setUint16(cd + 8, dv.getUint16(cd + 8, true) | 1, true);
  await assert.rejects(() => unzip(enc), /Password-protected/);
});

test('zip bomb: declared size smaller than real size is refused', async () => {
  const real = utf8('A'.repeat(2_000_000));
  const z = await zip([{ name: 'manifest.json', data: real }]);
  const dv = new DataView(z.buffer);
  // lie about the uncompressed size in both headers (and fix the CRC check path by keeping it)
  dv.setUint32(22, 1000, true);
  const cd = dv.getUint32(z.length - 22 + 16, true);
  dv.setUint32(cd + 24, 1000, true);
  await assert.rejects(() => unzip(z), ZipError);
});

test('declared sizes above the limits are refused before any decompression', async () => {
  const z = await zip([{ name: 'manifest.json', data: utf8('x'.repeat(100)) }]);
  const dv = new DataView(z.buffer);
  const cd = dv.getUint32(z.length - 22 + 16, true);
  dv.setUint32(cd + 24, 0x7fffffff, true);
  await assert.rejects(() => unzip(z), /too large/);
  const many = await zip(Array.from({ length: 9 }, (_, i) => ({ name: `f${i}`, data: utf8('x') })));
  await assert.rejects(() => unzip(many), /unexpected layout/);
});

test('duplicate names are refused', async () => {
  const f = join(dir, 'dup.zip');
  py(`import zipfile,sys,warnings
warnings.simplefilter('ignore')
with zipfile.ZipFile(sys.argv[1],'w') as z:
    z.writestr('a.txt','1'); z.writestr('a.txt','2')`, f);
  await assert.rejects(() => unzip(new Uint8Array(readFileSync(f))), ZipError);
});

test('concat helper sanity', () => assert.deepEqual(concat(new Uint8Array([1]), new Uint8Array([2, 3])), new Uint8Array([1, 2, 3])));
