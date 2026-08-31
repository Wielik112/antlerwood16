// POST /api/login  { password }  → ustawia ciasteczko sesji admina
const { makeToken, setSessionCookie, readJson } = require('./_lib');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return res.status(500).json({
      error: 'Brak ustawionej zmiennej ADMIN_PASSWORD na serwerze (Vercel → Settings → Environment Variables).',
    });
  }

  const { password } = await readJson(req);
  if (!password || String(password) !== String(expected)) {
    return res.status(401).json({ error: 'Nieprawidłowe hasło.' });
  }

  setSessionCookie(res, makeToken());
  return res.status(200).json({ ok: true });
};
