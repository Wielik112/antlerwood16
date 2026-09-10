// POST /api/pay/notify?provider=przelewy24|payu|tpay
//   Odbiornik powiadomień (IPN) z bramek. To najpewniejszy moment odnotowania
//   płatności — bramka woła ten adres po zaksięgowaniu, niezależnie od tego,
//   czy klient wrócił na stronę „dziękujemy".
//
// Weryfikacja podpisu/hash odbywa się w module bramki (patrz _providers.js).
// Potrzebujemy SUROWEGO body (PayU liczy md5 z surowych bajtów), dlatego
// wyłączamy parser Vercela i parsujemy sami wg Content-Type.
const {
  ensureSchema, readRawBody, markOrderPaid, getOrder, sql, wrap,
} = require('../_lib');
const { getProvider } = require('./_providers');

function parseBody(req, raw) {
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  const str = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '');
  if (ct.includes('application/json')) {
    try { return JSON.parse(str || '{}'); } catch { return {}; }
  }
  // form-urlencoded (Tpay) lub inne — parsujemy jako querystring.
  const out = {};
  new URLSearchParams(str).forEach((v, k) => { out[k] = v; });
  return out;
}

module.exports = wrap(async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const provider = getProvider(req.query.provider);
  if (!provider) return res.status(400).json({ error: 'Nieznana metoda płatności.' });

  const raw = await readRawBody(req);
  const body = parseBody(req, raw);

  let info;
  try {
    info = await provider.parseNotification(req, raw, body);
  } catch (err) {
    console.error('[pay/notify]', provider.id, err && err.message);
    return res.status(400).json({ error: 'Weryfikacja powiadomienia nie powiodła się.' });
  }

  if (info.paid) {
    await ensureSchema();
    // Dopasuj po naszym id; gdy brak — spróbuj po identyfikatorze transakcji bramki.
    let order = info.orderId ? await getOrder(info.orderId) : null;
    let orderId = info.orderId;
    if (!order && info.providerRef) {
      const { rows } = await sql`SELECT id FROM orders WHERE provider_ref = ${info.providerRef} LIMIT 1;`;
      if (rows.length) { orderId = rows[0].id; order = await getOrder(orderId); }
    }
    if (order) {
      // Zabezpieczenie: kwota z powiadomienia musi zgadzać się z zapisaną (gdy podana).
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
});

// Surowe body do weryfikacji podpisu (jak w webhooku Stripe).
module.exports.config = { api: { bodyParser: false } };
