// /api/photos/:photoId
//   GET    → serwuje zdjęcie galerii zapisane w bazie (BYTEA). Publiczne.
//            Dla zdjęć będących linkiem zewnętrznym — przekierowanie 302.
//   DELETE → usunięcie jednego zdjęcia z galerii (tylko admin) + aktualizacja
//            zdjęcia głównego produktu.
const {
  sql, ensureSchema, requireAuth, wrap, deletePhoto, syncMainImage, listPhotos,
} = require('../_lib');

module.exports = wrap(async function handler(req, res) {
  await ensureSchema();
  const id = req.query.id;

  if (req.method === 'GET') {
    const { rows } = await sql`SELECT data, mime, ext_url FROM product_photos WHERE photo_id = ${id};`;
    if (!rows.length) return res.status(404).json({ error: 'Brak zdjęcia.' });
    const row = rows[0];
    if (!row.data) {
      // zdjęcie zewnętrzne — przekieruj na oryginalny adres
      if (row.ext_url) { res.statusCode = 302; res.setHeader('Location', row.ext_url); return res.end(); }
      return res.status(404).json({ error: 'Brak danych zdjęcia.' });
    }
    const buf = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data);
    res.statusCode = 200;
    res.setHeader('Content-Type', row.mime || 'image/jpeg');
    res.setHeader('Content-Length', buf.length);
    // id jest unikalne dla każdego wgrania → treść niezmienna, można cache'ować na stałe
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.end(buf);
  }

  if (req.method === 'DELETE') {
    if (!requireAuth(req, res)) return;
    const productId = await deletePhoto(id);
    if (!productId) return res.status(404).json({ error: 'Nie znaleziono zdjęcia.' });
    const img = await syncMainImage(productId);
    const photos = await listPhotos(productId);
    return res.status(200).json({ ok: true, productId, img, photos });
  }

  res.setHeader('Allow', 'GET, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
});
