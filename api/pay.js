// Polskie bramki płatności (Przelewy24 / PayU / Tpay) — JEDNA funkcja serverless,
// przełączana przez ?action=... (żeby zmieścić się w limicie funkcji planu Hobby).
//
//   GET  /api/pay?action=methods            -> lista skonfigurowanych bramek
//   POST /api/pay?action=create             -> utwórz płatność, zwróć { url }
//   POST /api/pay?action=notify&provider=.. -> odbiór powiadomienia (IPN) z bramki
//   GET  /api/pay?action=status&order=..    -> stan zamówienia (dla „dziękujemy")
//
// vercel.json mapuje ładne adresy (/api/pay/create itd.) na te akcje.
//
// BEZPIECZEŃSTWO: kwota liczona z bazy (nie z przeglądarki); powiadomienia
// weryfikowane podpisem/hashem bramki przed uznaniem zamówienia za opłacone.
const crypto = require('crypto');
const {
  sql, ensureSchema, readJson, readRawBody, wrap,
  shippingRate, insertPendingOrder, markOrderPaid, getOrder,
} = require('./_lib');
const { getProvider, availableProviders } = require('./pay/_providers');

// Bazowy adres strony (do urlReturn / urlStatus).
function baseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return String(process.env.PUBLIC_BASE_URL).replace(/\/+$/, '');
  const origin = req.headers.origin;
  if (origin) return String(origin).replace(/\/+$/, '');
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}
function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || '127.0.0.1';
}
function genOrderId() {
  return `aw_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

// ---------- action: methods ----------
async function handleMethods(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ providers: availableProviders() });
}

// ---------- action: create ----------
async function handleCreate(req, res) {
  const body = await readJson(req);
  const provider = getProvider(body.provider);
  if (!provider) return res.status(400).json({ error: 'Nieznana metoda płatności.' });
  if (!provider.isConfigured()) {
    return res.status(503).json({
      error: `Metoda „${provider.label}" nie jest jeszcze skonfigurowana (brak kluczy API).`,
    });
  }

  const email = String(body.email || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'Podaj poprawny adres e-mail.' });
  }
  const name = String(body.name || '').trim().slice(0, 120);

  await ensureSchema();

  const wanted = new Map();
  for (const it of (Array.isArray(body.items) ? body.items : [])) {
    const id = String((it && it.id) || '').trim();
    const qty = Math.max(1, Math.min(99, Math.round(Number(it && it.qty) || 0)));
    if (!id || !qty) continue;
    wanted.set(id, (wanted.get(id) || 0) + qty);
  }
  if (wanted.size === 0) return res.status(400).json({ error: 'Koszyk jest pusty.' });

  const ids = [...wanted.keys()];
  const { rows } = await sql`SELECT id, name, price FROM products WHERE id = ANY(${ids});`;
  const byId = new Map(rows.map((r) => [r.id, r]));

  const items = [];
  let subtotal = 0; // grosze
  for (const [id, qty] of wanted) {
    const p = byId.get(id);
    if (!p) continue;
    const price = Math.max(0, Math.round(Number(p.price) || 0));
    if (price <= 0) continue;
    subtotal += price * 100 * qty;
    items.push({ id, name: p.name || id, qty, amount: price * 100 * qty });
  }
  if (items.length === 0) return res.status(400).json({ error: 'Produkty z koszyka są niedostępne.' });

  const ship = shippingRate(body.region);
  const amount = subtotal + ship.amount; // grosze
  items.push({ id: '_shipping', name: `Wysyłka — ${ship.label}`, qty: 1, amount: ship.amount });

  const order = genOrderId();
  const base = baseUrl(req);
  const shipping = {
    region: String(body.region || 'pl'),
    name,
    address: String(body.address || '').trim().slice(0, 500),
  };

  await insertPendingOrder({
    id: order, provider: provider.id, amount, currency: 'pln', items, shipping, email, name,
  });

  let result;
  try {
    result = await provider.createTransaction({
      order,
      amount,
      description: `ANTLERWOOD zamówienie ${order}`,
      email,
      name,
      lang: body.lang,
      clientIp: clientIp(req),
      returnUrl: `${base}/dziekujemy.html?order=${encodeURIComponent(order)}&provider=${provider.id}`,
      notifyUrl: `${base}/api/pay/notify?provider=${provider.id}`,
    });
  } catch (err) {
    console.error('[pay/create]', provider.id, err && err.message);
    await sql`UPDATE orders SET status = 'failed' WHERE id = ${order};`.catch(() => {});
    return res.status(502).json({ error: 'Nie udało się utworzyć płatności. Spróbuj ponownie.' });
  }

  if (result.providerRef) {
    await sql`UPDATE orders SET provider_ref = ${result.providerRef} WHERE id = ${order};`.catch(() => {});
  }
  return res.status(200).json({ order, url: result.redirectUrl });
}

// ---------- action: notify (IPN) ----------
function parseNotifyBody(req, raw) {
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  const str = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '');
  if (ct.includes('application/json')) {
    try { return JSON.parse(str || '{}'); } catch { return {}; }
  }
  const out = {};
  new URLSearchParams(str).forEach((v, k) => { out[k] = v; });
  return out;
}

async function handleNotify(req, res) {
  const provider = getProvider(req.query.provider);
  if (!provider) return res.status(400).json({ error: 'Nieznana metoda płatności.' });

  const raw = await readRawBody(req);
  const body = parseNotifyBody(req, raw);

  let info;
  try {
    info = await provider.parseNotification(req, raw, body);
  } catch (err) {
    console.error('[pay/notify]', provider.id, err && err.message);
    return res.status(400).json({ error: 'Weryfikacja powiadomienia nie powiodła się.' });
  }

  if (info.paid) {
    await ensureSchema();
    let order = info.orderId ? await getOrder(info.orderId) : null;
    let orderId = info.orderId;
    if (!order && info.providerRef) {
      const { rows } = await sql`SELECT id FROM orders WHERE provider_ref = ${info.providerRef} LIMIT 1;`;
      if (rows.length) { orderId = rows[0].id; order = await getOrder(orderId); }
    }
    if (order) {
      if (info.amount && Math.abs(info.amount - Number(order.amount_total)) > 1) {
        console.error('[pay/notify] niezgodna kwota', orderId, info.amount, order.amount_total);
      } else {
        await markOrderPaid(orderId, info.providerRef);
      }
    } else {
      console.error('[pay/notify] nie znaleziono zamówienia', info.orderId, info.providerRef);
    }
  }

  // Tpay oczekuje w odpowiedzi dokładnie "TRUE"; pozostałe bramki — HTTP 200.
  if (provider.id === 'tpay') {
    res.setHeader('Content-Type', 'text/plain');
    return res.status(200).send('TRUE');
  }
  return res.status(200).json({ received: true });
}

// ---------- action: status ----------
async function handleStatus(req, res) {
  const id = String(req.query.order || '').trim();
  if (!id) return res.status(400).json({ error: 'Brak parametru order.' });
  await ensureSchema();
  const order = await getOrder(id);
  if (!order) return res.status(404).json({ error: 'Nie znaleziono zamówienia.' });
  return res.status(200).json({
    order: order.id,
    provider: order.provider,
    paid: order.status === 'paid',
    status: order.status,
    email: order.email || '',
    amount_total: Number(order.amount_total) || 0,
    currency: order.currency || 'pln',
    items: Array.isArray(order.items) ? order.items : [],
  });
}

module.exports = wrap(async function handler(req, res) {
  const action = String(req.query.action || '').toLowerCase();

  if (action === 'methods') {
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
    return handleMethods(req, res);
  }
  if (action === 'create') {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
    return handleCreate(req, res);
  }
  if (action === 'notify') {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
    return handleNotify(req, res);
  }
  if (action === 'status') {
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
    return handleStatus(req, res);
  }
  return res.status(400).json({ error: 'Nieznana akcja.' });
});

// Surowe body do weryfikacji podpisu powiadomień; create/status czytają JSON ręcznie.
module.exports.config = { api: { bodyParser: false } };
