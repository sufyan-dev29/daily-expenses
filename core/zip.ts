/**
 * Minimal ZIP reader/writer with no dependencies (the app has to run on old WebViews and I do not want a library
 * parsing hostile files). Writes deflate (or store when CompressionStream is missing). Reads store and deflate only,
 * with hard limits against zip bombs and path tricks. No zip64, no encryption, no multi-disk.
 */
import { concat, utf8 } from './bytes.ts';

export class ZipError extends Error {}

export const ZIP_LIMITS = { maxEntries: 8, maxEntryBytes: 256 * 1024 * 1024, maxTotalBytes: 300 * 1024 * 1024, maxArchiveBytes: 300 * 1024 * 1024 };

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function pump(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) { await reader.cancel().catch(() => {}); throw new ZipError('The file expands to more data than it declares. It was not opened.'); }
    chunks.push(value);
  }
  return concat(...chunks);
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  const cs = new CompressionStream('deflate-raw');
  const w = cs.writable.getWriter();
  void w.write(data as BufferSource).then(() => w.close());
  return pump(cs.readable as ReadableStream<Uint8Array>, data.length + 1024 + Math.ceil(data.length / 100) * 5);
}

async function inflateRaw(data: Uint8Array, expected: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new ZipError('This device cannot open compressed backups. Update Android System WebView.');
  const ds = new DecompressionStream('deflate-raw');
  const w = ds.writable.getWriter();
  void w.write(data as BufferSource).then(() => w.close()).catch(() => {});
  try {
    return await pump(ds.readable as ReadableStream<Uint8Array>, expected);
  } catch (e) {
    if (e instanceof ZipError) throw e;
    throw new ZipError('The backup file is damaged (could not be decompressed).');
  }
}

const u16 = (n: number) => new Uint8Array([n & 255, (n >>> 8) & 255]);
const u32 = (n: number) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);

export interface ZipFile { name: string; data: Uint8Array }

function safeName(name: string): boolean {
  return name.length > 0 && name.length <= 100 && !/[\\\0]/.test(name) && !name.startsWith('/') && !name.split('/').includes('..') && !/^[A-Za-z]:/.test(name);
}

export async function zip(files: ZipFile[], when = new Date()): Promise<Uint8Array> {
  const dosTime = ((when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((Math.max(when.getFullYear(), 1980) - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate()) & 0xffff;
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    if (!safeName(f.name)) throw new ZipError('Invalid file name');
    const name = utf8(f.name);
    const crc = crc32(f.data);
    const deflated = await deflateRaw(f.data);
    const useDeflate = !!deflated && deflated.length < f.data.length;
    const body = useDeflate ? deflated! : f.data;
    const method = useDeflate ? 8 : 0;
    const flags = 0x0800; // UTF-8 names
    const local = concat(u32(0x04034b50), u16(20), u16(flags), u16(method), u16(dosTime), u16(dosDate), u32(crc), u32(body.length), u32(f.data.length), u16(name.length), u16(0), name, body);
    centrals.push(concat(u32(0x02014b50), u16(20), u16(20), u16(flags), u16(method), u16(dosTime), u16(dosDate), u32(crc), u32(body.length), u32(f.data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name));
    locals.push(local);
    offset += local.length;
  }
  const centralBytes = concat(...centrals);
  const end = concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(centralBytes.length), u32(offset), u16(0));
  return concat(...locals, centralBytes, end);
}

export async function unzip(bytes: Uint8Array, limits = ZIP_LIMITS): Promise<ZipFile[]> {
  if (bytes.length > limits.maxArchiveBytes) throw new ZipError('The backup file is too large.');
  if (bytes.length < 22) throw new ZipError('This is not a backup file.');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End of central directory record: search backwards (it may be followed by a short comment).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipError('This is not a backup file.');
  const diskNo = dv.getUint16(eocd + 4, true);
  const entries = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (diskNo !== 0 || entries === 0xffff || cdOffset === 0xffffffff) throw new ZipError('Unsupported backup file.');
  if (entries === 0 || entries > limits.maxEntries) throw new ZipError('This backup file has an unexpected layout.');
  if (cdOffset + cdSize > eocd) throw new ZipError('The backup file is damaged.');

  const out: ZipFile[] = [];
  const seen = new Set<string>();
  let total = 0;
  let p = cdOffset;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > bytes.length || dv.getUint32(p, true) !== 0x02014b50) throw new ZipError('The backup file is damaged.');
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const csize = dv.getUint32(p + 20, true);
    const usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true);
    const elen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    if (flags & 1) throw new ZipError('Password-protected zip files are not supported. Use the app\'s own backup password instead.');
    if (flags & 8 && (csize === 0 || usize === 0)) throw new ZipError('Unsupported backup file.');
    if (method !== 0 && method !== 8) throw new ZipError('Unsupported compression method.');
    if (csize === 0xffffffff || usize === 0xffffffff || lho === 0xffffffff) throw new ZipError('Unsupported backup file.');
    if (usize > limits.maxEntryBytes) throw new ZipError('The backup file is too large.');
    total += usize;
    if (total > limits.maxTotalBytes) throw new ZipError('The backup file is too large.');
    const name = new TextDecoder('utf-8').decode(bytes.subarray(p + 46, p + 46 + nlen));
    if (!safeName(name) || name.endsWith('/') || seen.has(name)) throw new ZipError('The backup file contains an unsafe entry.');
    seen.add(name);
    p += 46 + nlen + elen + clen;

    if (lho + 30 > bytes.length || dv.getUint32(lho, true) !== 0x04034b50) throw new ZipError('The backup file is damaged.');
    const lnlen = dv.getUint16(lho + 26, true);
    const lelen = dv.getUint16(lho + 28, true);
    if (lnlen !== nlen || new TextDecoder('utf-8').decode(bytes.subarray(lho + 30, lho + 30 + lnlen)) !== name) throw new ZipError('The backup file is damaged (entry names do not match).');
    const start = lho + 30 + lnlen + lelen;
    if (start + csize > cdOffset) throw new ZipError('The backup file is damaged.');
    const raw = bytes.subarray(start, start + csize);
    let data: Uint8Array;
    if (method === 0) {
      if (csize !== usize) throw new ZipError('The backup file is damaged.');
      data = raw.slice();
    } else {
      data = await inflateRaw(raw, usize);
      if (data.length !== usize) throw new ZipError('The backup file is damaged.');
    }
    if (crc32(data) !== crc) throw new ZipError('The backup file is damaged (checksum mismatch).');
    out.push({ name, data });
  }
  return out;
}
