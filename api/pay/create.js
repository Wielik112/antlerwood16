// POST /api/pay/create
//   Body: { items:[{id,qty}], provider:'przelewy24'|'payu'|'tpay', email, name, region, address, lang }
//   Tworzy płatność w wybranej polskiej bramce i zwraca { url } do przekierowania.
//
// BEZPIECZEŃSTWO: ceny bierzemy z bazy (nie z przeglądarki). Klient przysyła tylko
// id + ilość; kwotę i koszt wysyłki wyliczamy po stronie serwera.
const crypto = require('crypto');
const {
  sql, ensureSchema, readJson, wrap, shippingRate, insertPendingOrder,
} = require('../_lib');
const { getProvider } = require('./_providers');

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

module.exports = wrap(async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = await readJson(req);
  const provider = getProvider(body.provider);
  if (!provider) {
    return res.status(400).json({ error: 'Nieznana metoda płatności.' });
  }
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

  // Znormalizuj koszyk: { id -> qty }.
  const wanted = new Map();
  for (const it of (Array.isArray(body.items) ? body.items : [])) {
    const id = String((it && it.id) || '').trim();
    const qty = Math.max(1, Math.min(99, Math.round(Number(it && it.qty) || 0)));
    if (!id || !qty) continue;
    wanted.set(id, (wanted.get(id) || 0) + qty);
  }
  if (wanted.size === 0) return res.status(400).json({ error: 'Koszyk jest pusty.' });

  // Prawdziwe ceny z bazy.
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
  if (items.length === 0) {
    return res.status(400).json({ error: 'Produkty z koszyka są niedostępne.' });
  }

  // Wysyłka (region wybrany na koszyku) doliczana po stronie serwera.
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

  // Zapis „pending" ZANIM wyślemy do bramki (żeby powiadomienie miało co zaktualizować).
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
    // Oznacz zamówienie jako nieudane (nie zostawiamy „pending" bez linku).
    await sql`UPDATE orders SET status = 'failed' WHERE id = ${order};`.catch(() => {});
    return res.status(502).json({ error: 'Nie udało się utworzyć płatności. Spróbuj ponownie.' });
  }

  // Zapamiętaj identyfikator transakcji po stronie bramki (do dopasowania powiadomień).
  if (result.providerRef) {
    await sql`UPDATE orders SET provider_ref = ${result.providerRef} WHERE id = ${order};`.catch(() => {});
  }

  return res.status(200).json({ order, url: result.redirectUrl });
});
