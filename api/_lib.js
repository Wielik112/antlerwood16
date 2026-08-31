// Wspólna warstwa dla funkcji serverless (Vercel Functions, Node.js).
// - połączenie z bazą Vercel Postgres
// - tworzenie tabeli produktów (uruchamiane raz, „lazy")
// - prosta autoryzacja admina (hasło + podpisane ciasteczko HMAC)
//
// Zmienne środowiskowe (ustawiane w panelu Vercel → Project → Settings → Environment Variables):
//   POSTGRES_URL   – dodawana automatycznie po podpięciu Vercel Postgres (Storage)
//   ADMIN_PASSWORD – hasło do panelu admina (ustaw własne, mocne)
//   AUTH_SECRET    – losowy sekret do podpisywania sesji (np. wynik `openssl rand -hex 32`)

const crypto = require('crypto');
const { Pool } = require('pg');

// Nazwy zmiennych, pod którymi Vercel / integracja Neon potrafi trzymać connection string.
// Obsługujemy kilka, żeby zadziałało niezależnie od tego, jak baza została podpięta.
const DB_URL_KEYS = [
  'POSTGRES_URL',
  'POSTGRES_PRISMA_URL',
  'DATABASE_URL',
  'POSTGRES_URL_NON_POOLING',
  'DATABASE_URL_UNPOOLED',
];

function pickDbUrl() {
  for (const k of DB_URL_KEYS) {
    if (process.env[k]) return { key: k, url: process.env[k] };
  }
  return { key: null, url: null };
}

// Czy dany connection string jest „pooled" (przez pgbouncer)? (tylko informacyjnie)
function isPooled(url) {
  return !!url && (/-pooler\./.test(url) || /[?&]pgbouncer=true/.test(url));
}
function pickPooledUrl() {
  for (const k of DB_URL_KEYS) {
    if (isPooled(process.env[k])) return process.env[k];
  }
  return null;
}

// Połączenie z bazą przez klasyczny sterownik `pg` (TCP) — działa z każdym
// connection stringiem (pooled i direct), bez WebSocketów. Neon/Vercel Postgres
// wymaga SSL; connection string zwykle zawiera już `sslmode=require`.
let _pool = null;
function getPool() {
  if (_pool) return _pool;
  const { url } = pickDbUrl();
  if (!url) throw new Error('Brak connection stringa do bazy (POSTGRES_URL / DATABASE_URL).');
  const needsSsl = /sslmode=require/i.test(url) || /neon\.tech|vercel|supabase|amazonaws|render\.com/i.test(url);
  _pool = new Pool({
    connectionString: url,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    max: 3,                       // mało połączeń — panel admina ma niski ruch
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
  });
  // nie wywalaj procesu przy błędzie bezczynnego połączenia
  _pool.on('error', () => {});
  return _pool;
}

// Tagged-template `sql\`...${x}...\`` → zapytanie parametryzowane ($1, $2, ...).
// Zwraca { rows }, tak jak dotychczas oczekują handlery.
function sql(strings, ...values) {
  let text = '';
  for (let i = 0; i < strings.length; i += 1) {
    text += strings[i];
    if (i < values.length) text += '$' + (i + 1);
  }
  return getPool().query(text, values);
}

const COOKIE_NAME = 'aw_admin';
const SESSION_TTL = 60 * 60 * 12; // 12 godzin

let tableReady = false;

// Utwórz tabele, jeśli jeszcze nie istnieją.
async function ensureSchema() {
  if (tableReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS products (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      cat         TEXT NOT NULL DEFAULT 'wood',
      tag         TEXT NOT NULL DEFAULT '',
      price       INTEGER NOT NULL DEFAULT 0,
      descr       TEXT NOT NULL DEFAULT '',
      art         TEXT NOT NULL DEFAULT 'w1',
      img         TEXT NOT NULL DEFAULT '',
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  // Zdjęcia produktów wgrane w panelu trzymamy w bazie (bez zewnętrznego storage / R2).
  // Osobna tabela, żeby duże bajty nie obciążały zapytań o listę produktów.
  await sql`
    CREATE TABLE IF NOT EXISTS product_images (
      id          TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
      data        BYTEA NOT NULL,
      mime        TEXT NOT NULL DEFAULT 'image/jpeg',
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  tableReady = true;
}

// Zapisz zdjęcie (data URL: "data:image/jpeg;base64,...") do bazy i zwróć adres,
// pod którym będzie serwowane. Produkt o danym id musi już istnieć (klucz obcy).
const IMG_MAX_BYTES = 4 * 1024 * 1024; // 4 MB po kompresji
async function saveImage(id, dataUrl) {
  const m = /^data:([\w/+.-]+);base64,(.*)$/s.exec(String(dataUrl || ''));
  if (!m) throw new Error('Nieprawidłowy format obrazu (oczekiwano data URL base64).');
  const mime = m[1];
  if (!/^image\//i.test(mime)) throw new Error('Plik nie jest obrazem.');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) throw new Error('Pusty plik obrazu.');
  if (buf.length > IMG_MAX_BYTES) throw new Error('Obraz jest za duży (limit 4 MB po kompresji).');
  await sql`
    INSERT INTO product_images (id, data, mime, updated_at)
    VALUES (${id}, ${buf}, ${mime}, now())
    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, mime = EXCLUDED.mime, updated_at = now();
  `;
  return `/api/img/${encodeURIComponent(id)}?v=${Date.now()}`;
}

// Czy wartość pola img to wgrany plik (data URL) zamiast zwykłego linku?
function isDataUrl(v) {
  return typeof v === 'string' && v.startsWith('data:');
}

// Zamień wiersz z bazy na obiekt produktu w formacie, którego używa frontend.
function rowToProduct(r) {
  return {
    id: r.id,
    name: r.name,
    cat: r.cat,
    tag: r.tag,
    price: Number(r.price),
    desc: r.descr,          // frontend używa pola „desc"
    art: r.art,
    img: r.img,
  };
}

// ---------- Autoryzacja ----------

function authSecret() {
  // Fallback tylko po to, żeby lokalnie nie wywalało błędu; na produkcji ustaw AUTH_SECRET.
  return process.env.AUTH_SECRET || process.env.ADMIN_PASSWORD || 'antlerwood-dev-secret';
}

// Podpisany token: "exp.signature". Bez zewnętrznych bibliotek (tylko crypto).
function makeToken() {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
  const sig = crypto.createHmac('sha256', authSecret()).update(String(exp)).digest('hex');
  return `${exp}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  const expected = crypto.createHmac('sha256', authSecret()).update(String(exp)).digest('hex');
  // porównanie odporne na timing
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx > -1) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function setSessionCookie(res, token) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${SESSION_TTL}`,
    'Secure',
  ];
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure`);
}

// Zwraca true, jeśli żądanie ma ważną sesję admina.
function isAuthed(req) {
  const cookies = parseCookies(req);
  return verifyToken(cookies[COOKIE_NAME]);
}

// Strażnik: kończy odpowiedź 401, jeśli brak autoryzacji. Zwraca true, gdy OK.
function requireAuth(req, res) {
  if (isAuthed(req)) return true;
  res.status(401).json({ error: 'Unauthorized' });
  return false;
}

// Opakowanie handlera: łapie każdy wyjątek i zwraca czytelny JSON zamiast gołego 500.
// Dzięki temu w panelu widać prawdziwą przyczynę (np. brak podłączonej bazy).
function wrap(handler) {
  return async function (req, res) {
    try {
      await handler(req, res);
    } catch (err) {
      const raw = (err && err.message) ? err.message : String(err);
      let friendly = raw;
      if (/missing_connection_string|POSTGRES_URL|connection string|VercelPostgresError/i.test(raw)) {
        friendly = 'Baza danych nie jest podłączona (brak zmiennej POSTGRES_URL). '
          + 'Vercel → Storage → utwórz/podłącz Postgres do projektu, a potem zrób Redeploy.';
      }
      // log do konsoli funkcji (widoczny w Vercel → Logs)
      console.error('[api] error:', raw);
      if (!res.headersSent) res.status(500).json({ error: friendly });
    }
  };
}

// Odczyt JSON z body (Vercel zwykle parsuje sam, ale zabezpieczamy się na oba przypadki).
async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return await new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { resolve({}); }
    });
  });
}

module.exports = {
  sql,
  ensureSchema,
  rowToProduct,
  makeToken,
  isAuthed,
  requireAuth,
  setSessionCookie,
  clearSessionCookie,
  readJson,
  wrap,
  pickDbUrl,
  pickPooledUrl,
  saveImage,
  isDataUrl,
  DB_URL_KEYS,
  COOKIE_NAME,
};
