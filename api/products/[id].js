// /api/products/:id
//   GET    → jeden produkt (publiczny, używany przez stronę produktu)
//   PUT    → edycja produktu (tylko admin)
//   DELETE → usunięcie produktu (tylko admin)
const {
  sql, ensureSchema, rowToProduct, requireAuth, readJson, wrap,
} = require('../_lib');
const { validate } = require('../products');

module.exports = wrap(async function handler(req, res) {
  await ensureSchema();
  const id = req.query.id;

  if (req.method === 'GET') {
    const { rows } = await sql`SELECT * FROM products WHERE id = ${id};`;
    if (!rows.length) return res.status(404).json({ error: 'Nie znaleziono produktu.' });
    return res.status(200).json(rowToProduct(rows[0]));
  }

  if (req.method === 'PUT') {
    if (!requireAuth(req, res)) return;
    const body = await readJson(req);
    const { data, error } = validate(body);
    if (error) return res.status(400).json({ error });

    const { rows } = await sql`
      UPDATE products SET
        name = ${data.name},
        cat = ${data.cat},
        tag = ${data.tag},
        price = ${data.price},
        descr = ${data.descr},
        art = ${data.art},
        img = ${data.img}
      WHERE id = ${id}
      RETURNING *;
    `;
    if (!rows.length) return res.status(404).json({ error: 'Nie znaleziono produktu.' });
    return res.status(200).json(rowToProduct(rows[0]));
  }

  if (req.method === 'DELETE') {
    if (!requireAuth(req, res)) return;
    const { rows } = await sql`DELETE FROM products WHERE id = ${id} RETURNING id;`;
    if (!rows.length) return res.status(404).json({ error: 'Nie znaleziono produktu.' });
    return res.status(200).json({ ok: true, id });
  }

  res.setHeader('Allow', 'GET, PUT, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
});
