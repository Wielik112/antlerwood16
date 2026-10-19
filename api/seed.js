// POST /api/seed  (tylko admin)
// Wgrywa startowe 9 produktów do bazy — używane raz, przy pierwszym uruchomieniu.
// Domyślnie nie nadpisuje istniejących danych (bezpieczne do ponownego wywołania).
// Aby wymusić nadpisanie: POST /api/seed { "force": true }
const {
  sql, ensureSchema, rowToProduct, requireAuth, readJson, wrap,
} = require('./_lib');

// Lista startowa jest celowo PUSTA — sklep nie ma żadnych produktów domyślnie.
// Produkty dodajesz samodzielnie w panelu admina.
const SEED = [];

module.exports = wrap(async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  await ensureSchema();
  if (!requireAuth(req, res)) return;

  const { force } = await readJson(req);

  const count = await sql`SELECT COUNT(*)::int AS n FROM products;`;
  if (count.rows[0].n > 0 && !force) {
    return res.status(200).json({ ok: true, skipped: true, message: 'Baza nie jest pusta — pominięto. Użyj { "force": true }, aby nadpisać.' });
  }

  let i = 1;
  for (const p of SEED) {
    await sql`
      INSERT INTO products (id, name, cat, tag, price, descr, art, img, sort_order)
      VALUES (${p.id}, ${p.name}, ${p.cat}, ${p.tag}, ${p.price}, ${p.desc}, ${p.art}, ${p.img}, ${i})
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, cat = EXCLUDED.cat, tag = EXCLUDED.tag,
        price = EXCLUDED.price, descr = EXCLUDED.descr, art = EXCLUDED.art,
        img = EXCLUDED.img, sort_order = EXCLUDED.sort_order;
    `;
    i += 1;
  }

  const { rows } = await sql`SELECT * FROM products ORDER BY sort_order ASC;`;
  return res.status(200).json({ ok: true, seeded: rows.length, products: rows.map(rowToProduct) });
});
