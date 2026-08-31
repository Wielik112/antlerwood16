// GET /api/health  → diagnostyka konfiguracji (bez ujawniania wartości sekretów).
// Pomaga sprawdzić, czy baza i zmienne środowiskowe są poprawnie podpięte na Vercelu.
const {
  sql, ensureSchema, pickDbUrl, DB_URL_KEYS, wrap,
} = require('./_lib');

module.exports = wrap(async function handler(req, res) {
  const present = {};
  for (const k of DB_URL_KEYS) present[k] = Boolean(process.env[k]);

  const info = {
    env: {
      ADMIN_PASSWORD: Boolean(process.env.ADMIN_PASSWORD),
      AUTH_SECRET: Boolean(process.env.AUTH_SECRET),
      dbUrl: present,
      dbUrlUsed: pickDbUrl().key, // która zmienna zostanie użyta (nazwa, nie wartość)
    },
    db: { connected: false },
  };

  // spróbuj trywialnego zapytania
  try {
    await ensureSchema();
    const r = await sql`SELECT COUNT(*)::int AS n FROM products;`;
    info.db.connected = true;
    info.db.products = r.rows[0].n;
  } catch (err) {
    info.db.connected = false;
    info.db.error = (err && err.message) ? err.message : String(err);
  }

  return res.status(200).json(info);
});
