// POST /api/checkout
//   Body: { items: [{ id, qty }], lang }
//   Tworzy sesję Stripe Checkout (hostowana strona płatności) i zwraca { url }.
//
// WAŻNE (bezpieczeństwo): ceny bierzemy z bazy danych, NIE z przeglądarki.
// Klient przysyła tylko id produktu i ilość — kwotę wyliczamy po stronie serwera,
// żeby nie dało się zapłacić mniej przez podmianę danych w kliencie.
const {
  sql, ensureSchema, getStripe, readJson, wrap,
} = require('./_lib');

// Kraje, do których wysyłamy (zgodnie ze stroną „Wysyłka i zwroty").
const SHIP_TO = [
  'PL', 'DE', 'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'GR',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'RO', 'SK', 'SI', 'ES',
  'SE', 'GB', 'CH', 'NO', 'US', 'CA', 'AU',
];

// Opcje wysyłki prezentowane w Stripe Checkout (kwoty w groszach — 100 gr = 1 zł).
// Dostosuj kwoty/nazwy do własnego cennika. Klient wybiera opcję na stronie płatności.
const SHIPPING_OPTIONS = [
  {
    shipping_rate_data: {
      type: 'fixed_amount',
      fixed_amount: { amount: 1900, currency: 'pln' },
      display_name: 'Polska — kurier',
      delivery_estimate: {
        minimum: { unit: 'business_day', value: 2 },
        maximum: { unit: 'business_day', value: 5 },
      },
    },
  },
  {
    shipping_rate_data: {
      type: 'fixed_amount',
      fixed_amount: { amount: 4900, currency: 'pln' },
      display_name: 'Europa (UE / EU)',
      delivery_estimate: {
        minimum: { unit: 'business_day', value: 4 },
        maximum: { unit: 'business_day', value: 10 },
      },
    },
  },
  {
    shipping_rate_data: {
      type: 'fixed_amount',
      fixed_amount: { amount: 9900, currency: 'pln' },
      display_name: 'Świat (Worldwide)',
      delivery_estimate: {
        minimum: { unit: 'business_day', value: 7 },
        maximum: { unit: 'business_day', value: 21 },
      },
    },
  },
];

// Locale Stripe na podstawie języka strony (pl/en/de).
function stripeLocale(lang) {
  const l = String(lang || '').toLowerCase();
  if (l === 'pl' || l === 'de' || l === 'en') return l;
  return 'auto';
}

// Bazowy adres strony (do success_url / cancel_url oraz absolutnych adresów zdjęć).
function baseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return String(process.env.PUBLIC_BASE_URL).replace(/\/+$/, '');
  const origin = req.headers.origin;
  if (origin) return String(origin).replace(/\/+$/, '');
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

// Zamień adres zdjęcia produktu na absolutny URL http(s), który akceptuje Stripe.
// Pomijamy zdjęcia typu data: (Stripe ich nie przyjmuje) i puste wartości.
function absoluteImage(img, base) {
  const v = String(img || '').trim();
  if (!v || v.startsWith('data:')) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith('/')) return base + v;
  return `${base}/${v}`;
}

module.exports = wrap(async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  await ensureSchema();
  const stripe = getStripe();
  const body = await readJson(req);

  // Znormalizuj koszyk: { id -> qty }, odrzuć bzdury.
  const wanted = new Map();
  for (const it of (Array.isArray(body.items) ? body.items : [])) {
    const id = String(it && it.id || '').trim();
    const qty = Math.max(1, Math.min(99, Math.round(Number(it && it.qty) || 0)));
    if (!id || !qty) continue;
    wanted.set(id, (wanted.get(id) || 0) + qty);
  }
  if (wanted.size === 0) {
    return res.status(400).json({ error: 'Koszyk jest pusty.' });
  }

  // Pobierz prawdziwe produkty z bazy (ceny, nazwy, zdjęcie główne).
  const ids = [...wanted.keys()];
  const { rows } = await sql`SELECT id, name, price, img FROM products WHERE id = ANY(${ids});`;
  const byId = new Map(rows.map((r) => [r.id, r]));

  const base = baseUrl(req);
  const line_items = [];
  for (const [id, qty] of wanted) {
    const p = byId.get(id);
    if (!p) continue; // produkt zniknął — pomiń
    const price = Math.max(0, Math.round(Number(p.price) || 0));
    if (price <= 0) continue; // produkt bez ceny — nie sprzedajemy przez Stripe
    const image = absoluteImage(p.img, base);
    line_items.push({
      quantity: qty,
      price_data: {
        currency: 'pln',
        unit_amount: price * 100, // złote → grosze
        product_data: {
          name: p.name || id,
          metadata: { product_id: id },
          ...(image ? { images: [image] } : {}),
        },
      },
    });
  }

  if (line_items.length === 0) {
    return res.status(400).json({ error: 'Produkty z koszyka są niedostępne.' });
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items,
    locale: stripeLocale(body.lang),
    billing_address_collection: 'auto',
    phone_number_collection: { enabled: true },
    shipping_address_collection: { allowed_countries: SHIP_TO },
    shipping_options: SHIPPING_OPTIONS,
    // {CHECKOUT_SESSION_ID} podmieni Stripe — strona „dziękujemy" użyje go do potwierdzenia.
    success_url: `${base}/dziekujemy.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/koszyk.html?canceled=1`,
    metadata: {
      cart: JSON.stringify([...wanted.entries()].map(([id, qty]) => ({ id, qty }))).slice(0, 4900),
    },
  });

  return res.status(200).json({ id: session.id, url: session.url });
});
