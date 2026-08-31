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
const { createPool, createClient } = require('@vercel/postgres');

// Nazwy zmiennych, pod którymi Vercel / integracja Neon potrafi trzymać connection string.
// @vercel/postgres domyślnie czyta tylko POSTGRES_URL — tu obsługujemy też pozostałe,
// żeby zadziałało niezależnie od tego, jak baza została podpięta.
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

// Czy dany connection string jest „pooled" (przez pgbouncer)?
// Neon: host z „-pooler.", Prisma-URL: parametr „pgbouncer=true".
function isPooled(url) {
  return !!url && (/-pooler\./.test(url) || /[?&]pgbouncer=true/.test(url));
}

// Znajdź URL pooled wśród wszystkich kandydatów (jeśli w ogóle istnieje).
function pickPooledUrl() {
  for (const k of DB_URL_KEYS) {
    if (isPooled(process.env[k])) return process.env[k];
  }
  return null;
}

// Wybór trybu połączenia:
//  - jeśli mamy connection string „pooled" → createPool (zalecane na produkcji),
//  - w przeciwnym razie (mamy tylko connection direct) → createClient,
//    który potrafi łączyć się bezpośrednio (bez tego @vercel/postgres rzuca
//    „invalid_connection_string: ... use a pooled connection string ...").
let _pool = null;
let _client = null;
let _clientReady = null;

async function getRunner() {
  const pooled = pickPooledUrl();
  if (pooled) {
    if (!_pool) _pool = createPool({ connectionString: pooled });
    return _pool;
  }
  const { url } = pickDbUrl();
  if (!_client) {
    _client = createClient(url ? { connectionString: url } : undefined);
    _clientReady = _client.connect().catch((e) => { _client = null; _clientReady = null; throw e; });
  }
  await _clientReady;
  return _client;
}

// Tagged-template zapytanie SQL, kompatybilne z dotychczasowym użyciem `sql\`...\``.
// Przy zerwanym połączeniu klienta resetuje je i próbuje raz jeszcze.
async function sql(strings, ...values) {
  try {
    const runner = await getRunner();
    return await runner.sql(strings, ...values);
  } catch (err) {
    const msg = String((err && err.message) || err);
    if (_client && /connect|terminat|ECONNRESET|closed|ended|timeout/i.test(msg)) {
      _client = null; _clientReady = null;
      const runner = await getRunner();
      return await runner.sql(strings, ...values);
    }
    throw err;
  }
}

const COOKIE_NAME = 'aw_admin';
const SESSION_TTL = 60 * 60 * 12; // 12 godzin

let tableReady = false;

// Utwórz tabelę produktów, jeśli jeszcze nie istnieje.
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
  tableReady = true;
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
  DB_URL_KEYS,
  COOKIE_NAME,
};
