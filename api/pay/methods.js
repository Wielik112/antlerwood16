// GET /api/pay/methods
//   Zwraca listę polskich bramek gotowych do użycia (mających ustawione klucze API).
//   Frontend pokazuje tylko te metody — dopóki nie wpiszesz kluczy, przycisk się nie pojawi.
const { wrap } = require('../_lib');
const { availableProviders } = require('./_providers');

module.exports = wrap(async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ providers: availableProviders() });
});
