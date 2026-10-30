// Generates deterministic Tauri bundle icons (PNG + ICO) without external tools.
// Run: node scripts/gen-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri', 'icons');

// ---------- PNG encoding ----------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Renders the LuMusic glyph (rounded gradient square + white note) as RGBA pixels. */
function renderPixels(size) {
  const px = new Uint8Array(size * size * 4);
  const r = size * 0.185; // corner radius
  const headCx = size * 0.4;
  const headCy = size * 0.72;
  const headRx = size * 0.16;
  const headRy = size * 0.115;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const inRounded =
        x >= r && x < size - r
          ? true
          : y >= r && y < size - r
            ? true
            : cornersOk(x, y, r, size);
      if (!inRounded) {
        px[i + 3] = 0; // transparent
        continue;
      }
      // Diagonal gradient indigo -> violet.
      const t = (x / size + y / size) / 2;
      let cr = Math.round(0x63 + (0xa8 - 0x63) * t);
      let cg = Math.round(0x66 + (0x55 - 0x66) * t);
      let cb = Math.round(0xf1 + (0xf7 - 0xf1) * t);
      // White note: ellipse head + stem + flag.
      const inHead =
        ((x - headCx) / headRx) ** 2 + ((y - headCy) / headRy) ** 2 <= 1;
      const inStem = x >= size * 0.52 && x < size * 0.575 && y >= size * 0.24 && y <= size * 0.74;
      const inFlag = x >= size * 0.575 && x < size * 0.72 && y >= size * 0.24 && y < size * 0.38;
      if (inHead || inStem || inFlag) {
        cr = 255;
        cg = 255;
        cb = 255;
      }
      px[i] = cr;
      px[i + 1] = cg;
      px[i + 2] = cb;
      px[i + 3] = 255;
    }
  }
  return px;
}

function cornersOk(x, y, r, size) {
  // Points within the rounded corner circles.
  const cx = x < r ? r : size - r;
  const cy = y < r ? r : size - r;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function encodePng(size) {
  const px = renderPixels(size);
  // Prepend the filter byte (0 = None) to every scanline.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- ICO packaging (PNG-compressed entries) ----------

function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(entries.length * 16);
  let offset = header.length + dir.length;
  const datas = [];
  entries.forEach(([size, png], idx) => {
    const base = idx * 16;
    dir[base] = size >= 256 ? 0 : size; // 0 means 256
    dir[base + 1] = size >= 256 ? 0 : size;
    dir.writeUInt16LE(1, base + 4); // planes
    dir.writeUInt16LE(32, base + 6); // bpp
    dir.writeUInt32LE(png.length, base + 8);
    dir.writeUInt32LE(offset, base + 12);
    offset += png.length;
    datas.push(png);
  });
  return Buffer.concat([header, dir, ...datas]);
}

// ---------- Main ----------

mkdirSync(outDir, { recursive: true });

const png16 = encodePng(16);
const png32 = encodePng(32);
const png48 = encodePng(48);
const png128 = encodePng(128);
const png256 = encodePng(256);

writeFileSync(path.join(outDir, '32x32.png'), png32);
writeFileSync(path.join(outDir, '128x128.png'), png128);
writeFileSync(path.join(outDir, '128x128@2x.png'), png256);
writeFileSync(path.join(outDir, 'icon.png'), png256);
writeFileSync(path.join(outDir, 'icon.ico'), encodeIco([[16, png16], [32, png32], [48, png48], [256, png256]]));

console.log(`Icons written to ${outDir}`);
