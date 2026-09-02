// GET /api/order?session_id=cs_...
//   Potwierdza sesję Stripe Checkout po powrocie na stronę „dziękujemy",
//   zapisuje zamówienie (idempotentnie) i zwraca podsumowanie do wyświetlenia.
//
// To „druga noga" obok webhooka: nawet gdyby webhook nie doszedł, powrót
// klienta na stronę potwierdzenia i tak odnotuje opłacone zamówienie.
const {
  ensureSchema, getStripe, recordOrder, wrap,
} = require('./_lib');

module.exports = wrap(async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const id = String(req.query.session_id || '').trim();
  if (!id) return res.status(400).json({ error: 'Brak parametru session_id.' });

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(id, {
    expand: ['line_items', 'payment_intent'],
  });

  const paid = session.payment_status === 'paid';
  if (paid) {
    await ensureSchema();
    await recordOrder(session);
  }

  const details = session.customer_details || {};
  return res.status(200).json({
    paid,
    payment_status: session.payment_status,
    email: details.email || '',
    name: details.name || '',
    amount_total: session.amount_total || 0,
    currency: session.currency || 'pln',
    items: (session.line_items && session.line_items.data ? session.line_items.data : []).map((li) => ({
      name: li.description || '',
      qty: li.quantity || 1,
      amount: li.amount_total != null ? li.amount_total : 0,
    })),
  });
});
