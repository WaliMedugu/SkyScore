// Draw the SkyScore mark (field strips under an orbiting satellite) as PNG/ICO app icons. No dependencies.
// Usage: node make-icons.mjs
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NAVY = [2, 52, 72];
const LIME = [190, 214, 0];
const WHITE = [255, 255, 255];

/** Coverage of the mark at a point in the 32×32 design grid: returns a colour or null. */
function sample(x, y) {
  const strokes = [
    [6, 24, 14, 8],
    [12, 24, 20, 8],
    [18, 24, 26, 8],
  ];
  if ((x - 25) ** 2 + (y - 7) ** 2 <= 3 ** 2) return WHITE;
  for (const [x1, y1, x2, y2] of strokes) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
    const px = x1 + t * dx - x;
    const py = y1 + t * dy - y;
    if (px * px + py * py <= 1.3 ** 2) return LIME;
  }
  return null;
}

/** Render at `size` px; `inset` shrinks the mark into the middle (maskable icons need a safe zone). */
function render(size, inset = 0) {
  const ss = 4;
  const px = Buffer.alloc(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = ((i + (sx + 0.5) / ss) / size - 0.5) / (1 - inset) + 0.5;
          const v = ((j + (sy + 0.5) / ss) / size - 0.5) / (1 - inset) + 0.5;
          const c = u >= 0 && u <= 1 && v >= 0 && v <= 1 ? (sample(u * 32, v * 32) ?? NAVY) : NAVY;
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const k = (j * size + i) * 4;
      px[k] = r / (ss * ss);
      px[k + 1] = g / (ss * ss);
      px[k + 2] = b / (ss * ss);
      px[k + 3] = 255;
    }
  }
  return png(size, px);
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/** ICO with embedded PNGs (Windows Vista and later). */
function ico(sizes) {
  const pngs = sizes.map((s) => render(s));
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(sizes.length, 4);
  let offset = 6 + 16 * sizes.length;
  const dir = sizes.map((s, i) => {
    const e = Buffer.alloc(16);
    e[0] = s >= 256 ? 0 : s;
    e[1] = s >= 256 ? 0 : s;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(pngs[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += pngs[i].length;
    return e;
  });
  return Buffer.concat([head, ...dir, ...pngs]);
}

function out(rel, data) {
  const p = join(ROOT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
  console.log(`  ${rel} (${data.length} bytes)`);
}

const field = "apps/field";
for (const [dpi, s] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) out(`${field}/android/app/src/main/res/mipmap-${dpi}/ic_launcher.png`, render(s));
out(`${field}/web/favicon.png`, render(32));
out(`${field}/web/icons/Icon-192.png`, render(192));
out(`${field}/web/icons/Icon-512.png`, render(512));
out(`${field}/web/icons/Icon-maskable-192.png`, render(192, 0.2));
out(`${field}/web/icons/Icon-maskable-512.png`, render(512, 0.2));
out(`${field}/windows/runner/resources/app_icon.ico`, ico([16, 32, 48, 256]));
out("apps/web/public/icon-192.png", render(192));
out("apps/web/public/icon-512.png", render(512));
