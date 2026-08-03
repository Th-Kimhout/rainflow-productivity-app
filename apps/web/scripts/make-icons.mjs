/**
 * Generates the app icons as PNGs, with no image dependency.
 *
 * Run with `node apps/web/scripts/make-icons.mjs` from the repo root. Only needed when the palette
 * or the mark changes — the output is committed.
 *
 * The repo has no image library and `packages/data`'s dependency list is deliberately tiny, so
 * adding sharp/canvas to draw four static files would be a bad trade. Node ships zlib, which is
 * the only hard part of a PNG — the rest is a header, a CRC and raw RGBA scanlines.
 *
 * The mark is a raindrop in Rain Blue on the §4.1 slate background: a circle unioned with the
 * triangle formed by its two tangent lines meeting at an apex above, which is what makes the
 * shoulders continuous rather than a cone stuck on a ball. Supersampled 4×4 for antialiasing.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const BG = [0x0f, 0x17, 0x2a]; // --background, Slate 900
const RAIN = [0x38, 0xbd, 0xf8]; // --rain, Sky 400

const CRC_TABLE = Int32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // Each scanline is prefixed with filter byte 0 — "none". Filtering would shrink the file and
  // these are a few KB either way.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Is (x, y) inside the raindrop, in a unit space where the drop is centred on (0.5, 0.5)? */
function inDrop(x, y, scale) {
  /*
   * The drop spans roughly the middle two thirds of the canvas: apex at ~0.14, base at ~0.79.
   * Filling the square is wrong for the one place this matters most — iOS rounds the corners of
   * a homescreen icon, so a full-bleed mark comes back with its shoulders cut off.
   */
  const cx = 0.5;
  const cy = 0.5 + 0.075 * scale;
  const r = 0.215 * scale;
  const dx = x - cx;
  const dy = y - cy;
  if (dx * dx + dy * dy <= r * r) return true;

  // Triangle: apex above, sides running down the circle's two tangent lines, so the silhouette
  // is smooth where they meet rather than kinked.
  const h = 0.44 * scale; // apex distance from the circle's centre
  if (h <= r) return false;
  const cosA = r / h;
  const sinA = Math.sqrt(1 - cosA * cosA);
  const apex = [cx, cy - h];
  const t1 = [cx - r * sinA, cy - r * cosA];
  const t2 = [cx + r * sinA, cy - r * cosA];

  const sign = (a, b, c) => (a[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (a[1] - c[1]);
  const p = [x, y];
  const d1 = sign(p, apex, t1);
  const d2 = sign(p, t1, t2);
  const d3 = sign(p, t2, apex);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** `scale` shrinks the mark inside the canvas — a maskable icon may be cropped to a circle. */
function draw(size, scale) {
  const out = Buffer.alloc(size * size * 4);
  const SS = 4; // supersamples per axis

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = (x + (sx + 0.5) / SS) / size;
          const py = (y + (sy + 0.5) / SS) / size;
          if (inDrop(px, py, scale)) hits++;
        }
      }
      const a = hits / (SS * SS);
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) out[i + c] = Math.round(BG[c] * (1 - a) + RAIN[c] * a);
      out[i + 3] = 255; // opaque: iOS composites a homescreen icon over white, not over the wallpaper
    }
  }
  return out;
}

const targets = [
  // iOS reads this for the homescreen. 180 is the largest size any current iPhone asks for.
  ["apps/web/src/app/apple-icon.png", 180, 1],
  ["apps/web/public/icon-192.png", 192, 1],
  ["apps/web/public/icon-512.png", 512, 1],
  // Maskable: Android crops to an arbitrary shape, so the mark sits inside the 80% safe circle.
  ["apps/web/public/icon-maskable-512.png", 512, 0.8],
];

for (const [path, size, scale] of targets) {
  writeFileSync(path, png(size, draw(size, scale)));
  console.log("wrote", path, `${size}×${size}`);
}
