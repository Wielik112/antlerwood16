// /api/products/:id
//   GET    → jeden produkt (publiczny, używany przez stronę produktu)
//   PUT    → edycja produktu (tylko admin)
//   DELETE → usunięcie produktu (tylko admin)
const {
  sql, ensureSchema, rowToProduct, requireAuth, readJson, wrap,
  addPhoto, syncMainImage, attachPhotos, isDataUrl,
} = require('../_lib');
const { validate } = require('../products');

module.exports = wrap(async function handler(req, res) {
  await ensureSchema();
  const id = req.query.id;

  if (req.method === 'GET') {
    const { rows } = await sql`SELECT * FROM products WHERE id = ${id};`;
    if (!rows.length) return res.status(404).json({ error: 'Nie znaleziono produktu.' });
    const [product] = await attachPhotos([rowToProduct(rows[0])]);
    return res.status(200).json(product);
  }

  if (req.method === 'PUT') {
    if (!requireAuth(req, res)) return;
    const body = await readJson(req);
    const { data, error } = validate(body);
    if (error) return res.status(400).json({ error });

    // Zdjęcie główne (products.img) jest wyliczane z galerii — nie nadpisujemy go tutaj
    // danymi tekstowymi formularza. Aktualizujemy tylko pozostałe pola produktu.
    const { rows } = await sql`
      UPDATE products SET
        name = ${data.name},
        cat = ${data.cat},
        tag = ${data.tag},
        price = ${data.price},
        descr = ${data.descr},
        desc_full = ${data.descFull},
        art = ${data.art}
      WHERE id = ${id}
      RETURNING *;
    `;
    if (!rows.length) return res.status(404).json({ error: 'Nie znaleziono produktu.' });

    // Zgodność wstecz: jeśli w payloadzie przyszło nowe wgrane zdjęcie (data URL),
    // dodajemy je do galerii. Panel admina zwykle zarządza zdjęciami osobno (/api/photos).
    if (isDataUrl(body.img)) {
      await addPhoto(id, body.img);
      await syncMainImage(id);
    }
    const fresh = await sql`SELECT * FROM products WHERE id = ${id};`;
    const [product] = await attachPhotos([rowToProduct(fresh.rows[0])]);
    return res.status(200).json(product);
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
