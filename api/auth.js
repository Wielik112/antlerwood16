// /api/auth — połączony endpoint autoryzacji admina.
// Dla zgodności ze starymi adresami vercel.json przepisuje:
//   /api/login   → /api/auth?action=login    (POST { password })
//   /api/logout  → /api/auth?action=logout   (POST)
//   /api/session → /api/auth?action=session  (GET → { authed })
// Połączenie trzech funkcji w jedną zmniejsza liczbę funkcji serverless
// (limit 12 na planie Hobby na Vercelu).
const {
  makeToken, setSessionCookie, clearSessionCookie, isAuthed, readJson, wrap,
} = require('./_lib');

module.exports = wrap(async function handler(req, res) {
  const action = String((req.query && req.query.action) || '').toLowerCase();

  if (action === 'session') {
    return res.status(200).json({ authed: isAuthed(req) });
  }

  if (action === 'login') {
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
  }

  if (action === 'logout') {
    clearSessionCookie(res);
    return res.status(200).json({ ok: true });
  }

  return res.status(404).json({ error: 'Nieznana akcja autoryzacji.' });
});
