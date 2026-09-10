// GET /api/pay/status?order=aw_...
//   Zwraca stan zamówienia (dla strony „dziękujemy"). Źródłem prawdy o płatności
//   jest powiadomienie z bramki (api/pay/notify) — tu tylko odczytujemy stan z bazy.
//   Przy przelewie/BLIK powiadomienie może przyjść z małym opóźnieniem — wtedy
//   status = 'pending' i strona pokazuje „przetwarzamy płatność".
const { ensureSchema, getOrder, wrap } = require('../_lib');

module.exports = wrap(async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
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
});
