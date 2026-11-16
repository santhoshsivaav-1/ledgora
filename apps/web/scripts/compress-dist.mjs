// v1.10.81 — Build-time precompression for the deployed app. Run after `vite build`.
//
// Reported: "the first time the application is so slow for the navigation ...
// and when I reload it was slow — deployed on the Railway free plan".
//
// The API serves apps/web/dist with @hono/node-server's serveStatic, which
// does NOT compress anything on its own, and Railway's edge does not either —
// so every first visit re-downloaded ~2.6 MB of raw JS/CSS (the bundled app),
// and the service worker's first-install precache streamed another ~2.4 MB on
// top, all competing with the user's clicks. On the free plan's shared CPU
// and a typical 5-10 Mbps link that is seconds before anything works — and
// every reload before the SW takes over paid the same bill again.
//
// This script writes a Brotli and a gzip twin beside every text file in dist
// (JS, CSS, HTML, SVG, manifest...; PNG/JPEG/WOFF2 are already compressed by
// their own formats). serveStatic(precompressed: true) in the API then hands
// the twins out with `Content-Encoding: br / gzip` — same bytes, a quarter of
// the wire time, zero runtime CPU on the free plan. Workbox's precache still
// stores the DECODED originals under the same URLs it always did, so offline
// works exactly as before. `pnpm build` runs it, so the Railway build command
// (`pnpm --filter @ledgora/web build`) picks it up with no other change.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants as zlib, gzipSync } from 'node:zlib';

const dist = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist');
// Only what a browser can decode for us on the way in.
const COMPRESSIBLE = new Set(['.js', '.mjs', '.css', '.html', '.svg', '.json', '.webmanifest', '.txt', '.xml', '.map']);
// Below this, the saved bytes do not even fill a leftover TCP packet.
const MIN_BYTES = 512;

const walk = (dir, into) => {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) walk(p, into);
    else into.push(p);
  }
  return into;
};

const dot = (p) => p.slice(p.lastIndexOf('.'));
const files = walk(dist, []).filter((p) => COMPRESSIBLE.has(dot(p)) && !p.endsWith('.br') && !p.endsWith('.gz'));

let rawTotal = 0;
let brTotal = 0;
let gzTotal = 0;
let brCount = 0;
let gzCount = 0;
for (const p of files) {
  const buf = readFileSync(p);
  if (buf.length < MIN_BYTES) continue;
  rawTotal += buf.length;
  // Quality 6: a ratio close to gzip -9's rival... at a build cost of a few
  // seconds across the whole dist, which the Railway build absorbs fine.
  const br = brotliCompressSync(buf, {
    params: { [zlib.BROTLI_PARAM_QUALITY]: 6, [zlib.BROTLI_PARAM_SIZE_HINT]: buf.length },
  });
  const gz = gzipSync(buf, { level: 6 });
  if (br.length < buf.length) {
    writeFileSync(`${p}.br`, br);
    brTotal += br.length;
    brCount++;
  }
  if (gz.length < buf.length) {
    writeFileSync(`${p}.gz`, gz);
    gzTotal += gz.length;
    gzCount++;
  }
}
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(
  `compress-dist: ${brCount} brotli twins (${kb(rawTotal)} → ${kb(brTotal)}), ${gzCount} gzip twins (${kb(gzTotal)}).`,
);
if (rawTotal > 0 && brCount === 0) console.error('compress-dist: nothing was compressed — check the dist layout.');
