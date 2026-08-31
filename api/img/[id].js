// GET /api/img/:id  → serwuje zdjęcie produktu zapisane w bazie (BYTEA).
// Publiczne (potrzebne do wyświetlania sklepu). Adres zawiera ?v=... (wersję),
// więc możemy cache'ować agresywnie — po podmianie zdjęcia zmienia się wersja.
const { sql, ensureSchema, wrap } = require('../_lib');

module.exports = wrap(async function handler(req, res) {
  await ensureSchema();
  const id = req.query.id;

  const { rows } = await sql`SELECT data, mime FROM product_images WHERE id = ${id};`;
  if (!rows.length) return res.status(404).json({ error: 'Brak zdjęcia.' });

  const row = rows[0];
  const buf = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data);

  res.statusCode = 200;
  res.setHeader('Content-Type', row.mime || 'image/jpeg');
  res.setHeader('Content-Length', buf.length);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  return res.end(buf);
});
