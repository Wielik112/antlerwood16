// GET /api/orders  → lista zamówień opłaconych przez Stripe (tylko admin).
// Używane przez panel admina do podglądu sprzedaży.
const {
  sql, ensureSchema, requireAuth, wrap,
} = require('./_lib');

module.exports = wrap(async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!requireAuth(req, res)) return;

  await ensureSchema();
  const { rows } = await sql`
    SELECT id, payment_intent, email, customer_name, amount_total, currency, status, items, shipping, created_at
    FROM orders ORDER BY created_at DESC LIMIT 200;
  `;
  return res.status(200).json(rows);
});
