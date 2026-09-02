// POST /api/webhook  — odbiornik zdarzeń Stripe (webhook).
//
// Stripe wysyła tu powiadomienia o zdarzeniach (m.in. zakończonej płatności).
// To najpewniejszy sposób odnotowania zamówienia — działa nawet, gdy klient
// zamknie kartę zaraz po zapłacie i nie wróci na stronę „dziękujemy".
//
// Weryfikacja podpisu wymaga SUROWEGO body — dlatego wyłączamy parser Vercela
// poniżej (config.api.bodyParser = false) i czytamy bajty ręcznie.
const {
  ensureSchema, getStripe, recordOrder, readRawBody, wrap,
} = require('./_lib');

module.exports = wrap(async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(500).json({
      error: 'Brak STRIPE_WEBHOOK_SECRET (Vercel → Settings → Environment Variables).',
    });
  }

  const stripe = getStripe();
  const sig = req.headers['stripe-signature'];
  const raw = await readRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    // Zły podpis = odrzucamy (może to próba podszycia się).
    console.error('[webhook] nieprawidłowy podpis:', err && err.message);
    return res.status(400).json({ error: `Webhook signature verification failed.` });
  }

  if (event.type === 'checkout.session.completed'
      || event.type === 'checkout.session.async_payment_succeeded') {
    await ensureSchema();
    // Dociągnij pozycje zamówienia (nie ma ich domyślnie w obiekcie zdarzenia).
    const full = await stripe.checkout.sessions.retrieve(event.data.object.id, {
      expand: ['line_items', 'payment_intent'],
    });
    await recordOrder(full);
  }

  // Zawsze 200 dla poprawnie podpisanych zdarzeń, żeby Stripe nie ponawiał w kółko.
  return res.status(200).json({ received: true });
});

// Wyłącz automatyczne parsowanie body — do weryfikacji podpisu potrzebujemy
// surowych bajtów żądania. (Ustawiamy po przypisaniu module.exports powyżej.)
module.exports.config = { api: { bodyParser: false } };
