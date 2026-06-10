import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FALLBACK_DIR = join(__dirname, '../fallback');
try { mkdirSync(FALLBACK_DIR, { recursive: true }); } catch {}

export function saveFallback(name, data) {
  try {
    writeFileSync(join(FALLBACK_DIR, `${name}.json`), JSON.stringify(data, null, 2));
  } catch { /* ignore write errors */ }
}

export function loadFallback(name) {
  try {
    return JSON.parse(readFileSync(join(FALLBACK_DIR, `${name}.json`), 'utf8'));
  } catch { return null; }
}

export function withFallback(name, handler) {
  return async (req, res) => {
    try {
      const result = await handler(req);
      saveFallback(name, result);
      res.json(result);
    } catch (err) {
      console.error(`[${name}] DB error, serving fallback:`, err.message);
      const fb = loadFallback(name);
      if (fb) return res.json({ ...fb, _fallback: true });
      res.status(503).json({ error: err.message });
    }
  };
}
