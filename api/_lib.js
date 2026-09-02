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
  // Drugi opis: "descr" = opis główny (krótki, na liście), "desc_full" = opis produktu
  // (pełny, na stronie produktu). ADD ... IF NOT EXISTS — bezpieczne dla istniejącej bazy.
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS desc_full TEXT NOT NULL DEFAULT '';`;
  // Zdjęcia produktów wgrane w panelu trzymamy w bazie (bez zewnętrznego storage / R2).
  // Osobna tabela, żeby duże bajty nie obciążały zapytań o listę produktów.
  // (starsza tabela 1:1 — zostawiamy dla zgodności i migracji)
  await sql`
    CREATE TABLE IF NOT EXISTS product_images (
      id          TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
      data        BYTEA NOT NULL,
      mime        TEXT NOT NULL DEFAULT 'image/jpeg',
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  // Galeria: WIELE zdjęć na produkt. Pierwsze (najmniejszy sort_order) = zdjęcie główne.
  // Zdjęcie może być wgrane (data = BYTEA) albo być zewnętrznym linkiem (ext_url).
  await sql`
    CREATE TABLE IF NOT EXISTS product_photos (
      photo_id    TEXT PRIMARY KEY,
      product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      data        BYTEA,
      mime        TEXT NOT NULL DEFAULT 'image/jpeg',
      ext_url     TEXT NOT NULL DEFAULT '',
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_product_photos_pid ON product_photos (product_id, sort_order);`;
  // Prosta tabelka na flagi/metadane (np. „migracja galerii wykonana").
  await sql`CREATE TABLE IF NOT EXISTS aw_meta (key TEXT PRIMARY KEY, val TEXT NOT NULL DEFAULT '');`;

  // Zamówienia opłacone przez Stripe. Kluczem jest identyfikator sesji Checkout,
  // dzięki czemu zapis jest idempotentny (webhook i powrót na stronę „dziękujemy"
  // mogą wywołać zapis tego samego zamówienia — nadpisze się bez duplikatów).
  await sql`
    CREATE TABLE IF NOT EXISTS orders (
      id            TEXT PRIMARY KEY,          -- Stripe Checkout Session id (cs_...)
      payment_intent TEXT NOT NULL DEFAULT '',
      email         TEXT NOT NULL DEFAULT '',
      customer_name TEXT NOT NULL DEFAULT '',
      amount_total  INTEGER NOT NULL DEFAULT 0, -- w groszach
      currency      TEXT NOT NULL DEFAULT 'pln',
      status        TEXT NOT NULL DEFAULT 'paid',
      items         JSONB NOT NULL DEFAULT '[]'::jsonb,
      shipping      JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_orders_created ON orders (created_at DESC);`;

  await migratePhotos();
  tableReady = true;
}

// Jednorazowa migracja: dla każdego produktu bez żadnego zdjęcia w galerii tworzymy
// wpis startowy na podstawie dotychczasowego stanu:
//   - jeśli istnieje wgrany plik w product_images → kopiujemy bajty,
//   - w przeciwnym razie jeśli products.img jest niepustym linkiem → wpis ext_url.
// Idempotentna: gdy produkt ma już zdjęcia w galerii, jest pomijany.
async function migratePhotos() {
  const done = await sql`SELECT val FROM aw_meta WHERE key = 'photos_migrated';`;
  if (done.rows.length && done.rows[0].val === '1') return;

  const prods = await sql`
    SELECT p.id, p.img,
           pi.data AS legacy_data, pi.mime AS legacy_mime,
           (SELECT COUNT(*)::int FROM product_photos ph WHERE ph.product_id = p.id) AS n
    FROM products p
    LEFT JOIN product_images pi ON pi.id = p.id;
  `;
  for (const r of prods.rows) {
    if (r.n > 0) continue; // już ma galerię
    const photoId = genPhotoId(r.id);
    if (r.legacy_data) {
      const buf = Buffer.isBuffer(r.legacy_data) ? r.legacy_data : Buffer.from(r.legacy_data);
      await sql`
        INSERT INTO product_photos (photo_id, product_id, data, mime, ext_url, sort_order)
        VALUES (${photoId}, ${r.id}, ${buf}, ${r.legacy_mime || 'image/jpeg'}, '', 0);
      `;
      await sql`UPDATE products SET img = ${photoUrlFor(photoId, '')} WHERE id = ${r.id};`;
    } else if (r.img && String(r.img).trim()) {
      await sql`
        INSERT INTO product_photos (photo_id, product_id, data, mime, ext_url, sort_order)
        VALUES (${photoId}, ${r.id}, NULL, 'image/jpeg', ${String(r.img).trim()}, 0);
      `;
    }
  }
  await sql`
    INSERT INTO aw_meta (key, val) VALUES ('photos_migrated', '1')
    ON CONFLICT (key) DO UPDATE SET val = '1';
  `;
}

// ---------- Galeria zdjęć ----------

function genPhotoId(productId) {
  const rand = crypto.randomBytes(4).toString('hex');
  return `${String(productId).slice(0, 40)}-${Date.now().toString(36)}-${rand}`;
}

// Adres, pod którym serwowane jest zdjęcie: link zewnętrzny albo endpoint na bajty.
function photoUrlFor(photoId, extUrl) {
  return (extUrl && String(extUrl).trim()) ? String(extUrl).trim() : `/api/photos/${encodeURIComponent(photoId)}`;
}
function photoUrl(row) {
  return photoUrlFor(row.photo_id, row.ext_url);
}

// Dodaj jedno zdjęcie do galerii produktu. `value` to data URL (wgrany plik) LUB zwykły link.
// Zwraca { id, url }. Zakłada, że produkt istnieje (klucz obcy).
async function addPhoto(productId, value, sortOrder) {
  const photoId = genPhotoId(productId);
  const ord = (sortOrder == null) ? await nextPhotoOrder(productId) : sortOrder;

  if (isDataUrl(value)) {
    const m = /^data:([\w/+.-]+);base64,(.*)$/s.exec(String(value));
    if (!m) throw new Error('Nieprawidłowy format obrazu (oczekiwano data URL base64).');
    const mime = m[1];
    if (!/^image\//i.test(mime)) throw new Error('Plik nie jest obrazem.');
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length) throw new Error('Pusty plik obrazu.');
    if (buf.length > IMG_MAX_BYTES) throw new Error('Obraz jest za duży (limit 4 MB po kompresji).');
    await sql`
      INSERT INTO product_photos (photo_id, product_id, data, mime, ext_url, sort_order)
      VALUES (${photoId}, ${productId}, ${buf}, ${mime}, '', ${ord});
    `;
  } else {
    const url = String(value || '').trim();
    if (!url) throw new Error('Pusty adres zdjęcia.');
    await sql`
      INSERT INTO product_photos (photo_id, product_id, data, mime, ext_url, sort_order)
      VALUES (${photoId}, ${productId}, NULL, 'image/jpeg', ${url}, ${ord});
    `;
  }
  return { id: photoId, url: photoUrlFor(photoId, isDataUrl(value) ? '' : value) };
}

async function nextPhotoOrder(productId) {
  const r = await sql`SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM product_photos WHERE product_id = ${productId};`;
  return r.rows[0].next;
}

// Lista zdjęć produktu w kolejności. Zwraca [{ id, url }].
async function listPhotos(productId) {
  const { rows } = await sql`
    SELECT photo_id, ext_url FROM product_photos
    WHERE product_id = ${productId} ORDER BY sort_order ASC, created_at ASC;
  `;
  return rows.map((r) => ({ id: r.photo_id, url: photoUrl(r) }));
}

// Usuń jedno zdjęcie. Zwraca product_id, do którego należało (lub null).
async function deletePhoto(photoId) {
  const { rows } = await sql`DELETE FROM product_photos WHERE photo_id = ${photoId} RETURNING product_id;`;
  return rows.length ? rows[0].product_id : null;
}

// Ustaw kolejność zdjęć produktu wg podanej listy id (pierwsze = główne).
// Id spoza listy trafiają na koniec (z zachowaniem dotychczasowej kolejności).
async function setPhotoOrder(productId, ids) {
  const existing = await sql`SELECT photo_id FROM product_photos WHERE product_id = ${productId} ORDER BY sort_order ASC;`;
  const known = new Set(existing.rows.map((r) => r.photo_id));
  const ordered = [];
  for (const id of (ids || [])) if (known.has(id) && !ordered.includes(id)) ordered.push(id);
  for (const r of existing.rows) if (!ordered.includes(r.photo_id)) ordered.push(r.photo_id);
  let i = 0;
  for (const id of ordered) {
    await sql`UPDATE product_photos SET sort_order = ${i} WHERE photo_id = ${id};`;
    i += 1;
  }
}

// Ustaw products.img na adres pierwszego zdjęcia galerii (albo '' gdy brak zdjęć).
async function syncMainImage(productId) {
  const { rows } = await sql`
    SELECT photo_id, ext_url FROM product_photos
    WHERE product_id = ${productId} ORDER BY sort_order ASC, created_at ASC LIMIT 1;
  `;
  const img = rows.length ? photoUrl(rows[0]) : '';
  await sql`UPDATE products SET img = ${img} WHERE id = ${productId};`;
  return img;
}

// Dołącz galerię do listy produktów jednym zapytaniem (bez N+1).
// Ustawia p.images (tablica adresów) i p.photos ([{id,url}] dla panelu).
async function attachPhotos(products) {
  if (!products.length) return products;
  const { rows } = await sql`
    SELECT photo_id, product_id, ext_url FROM product_photos
    ORDER BY product_id, sort_order ASC, created_at ASC;
  `;
  const byProduct = new Map();
  for (const r of rows) {
    if (!byProduct.has(r.product_id)) byProduct.set(r.product_id, []);
    byProduct.get(r.product_id).push({ id: r.photo_id, url: photoUrl(r) });
  }
  for (const p of products) {
    const photos = byProduct.get(p.id) || [];
    if (photos.length) {
      p.photos = photos;
      p.images = photos.map((x) => x.url);
      p.img = photos[0].url;
    } else {
      // brak galerii — fallback na dotychczasowe pojedyncze zdjęcie (np. seed z linkiem)
      p.photos = p.img ? [{ id: null, url: p.img }] : [];
      p.images = p.img ? [p.img] : [];
    }
  }
  return products;
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
    desc: r.descr,          // opis główny (krótki) — frontend używa pola „desc"
    descFull: r.desc_full || '', // opis produktu (pełny) — strona produktu
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

// ---------- Stripe (płatności) ----------

// Leniwa inicjalizacja klienta Stripe. Klucz sekretny bierzemy ze zmiennej
// środowiskowej STRIPE_SECRET_KEY (ustaw na Vercelu → Settings → Environment Variables).
let _stripe = null;
function getStripe() {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      'Płatności nie są skonfigurowane (brak STRIPE_SECRET_KEY). '
      + 'Vercel → Settings → Environment Variables → dodaj STRIPE_SECRET_KEY, potem Redeploy.',
    );
  }
  // Wymagane dopiero tutaj, żeby brak pakietu nie wywalał pozostałych endpointów.
  const Stripe = require('stripe');
  _stripe = new Stripe(key, { apiVersion: '2024-12-18.acacia' });
  return _stripe;
}

// Zapis opłaconego zamówienia do bazy na podstawie sesji Stripe Checkout.
// Idempotentny: klucz główny = id sesji, więc powtórny zapis (webhook + powrót
// użytkownika) tylko odświeża rekord zamiast tworzyć duplikat.
// `session` powinno mieć rozwinięte `line_items` (expand: ['line_items']).
async function recordOrder(session) {
  if (!session || !session.id) return;
  const items = (session.line_items && session.line_items.data ? session.line_items.data : []).map((li) => ({
    name: li.description || (li.price && li.price.product) || '',
    qty: li.quantity || 1,
    amount: li.amount_total != null ? li.amount_total : (li.price ? li.price.unit_amount * (li.quantity || 1) : 0),
  }));
  const details = session.customer_details || {};
  const shipping = session.shipping_details || session.shipping || {};
  await sql`
    INSERT INTO orders (id, payment_intent, email, customer_name, amount_total, currency, status, items, shipping)
    VALUES (
      ${session.id},
      ${typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent && session.payment_intent.id) || ''},
      ${details.email || ''},
      ${details.name || (shipping && shipping.name) || ''},
      ${session.amount_total || 0},
      ${session.currency || 'pln'},
      ${session.payment_status === 'paid' ? 'paid' : (session.status || 'pending')},
      ${JSON.stringify(items)},
      ${JSON.stringify(shipping || {})}
    )
    ON CONFLICT (id) DO UPDATE SET
      payment_intent = EXCLUDED.payment_intent,
      email = EXCLUDED.email,
      customer_name = EXCLUDED.customer_name,
      amount_total = EXCLUDED.amount_total,
      currency = EXCLUDED.currency,
      status = EXCLUDED.status,
      items = EXCLUDED.items,
      shipping = EXCLUDED.shipping;
  `;
}

// Odczyt surowego (nieparsowanego) body — potrzebne do weryfikacji podpisu webhooka.
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    // Jeśli Vercel udostępnił już surowy bufor/tekst, użyj go bez czytania streamu.
    if (Buffer.isBuffer(req.body)) return resolve(req.body);
    if (typeof req.body === 'string') return resolve(Buffer.from(req.body));
    const chunks = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
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
  addPhoto,
  listPhotos,
  deletePhoto,
  setPhotoOrder,
  syncMainImage,
  attachPhotos,
  getStripe,
  recordOrder,
  readRawBody,
  DB_URL_KEYS,
  COOKIE_NAME,
};
