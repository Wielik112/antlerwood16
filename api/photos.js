// /api/photos  (tylko admin)
//   POST { productId, img }        → dodaj zdjęcie do galerii produktu
//                                    (img = data URL wgranego pliku lub zwykły link)
//   PUT  { productId, order:[ids] } → ustaw kolejność zdjęć (pierwsze = główne)
// /api/photos/:id  (vercel.json przepisuje na /api/photos?id=:id)
//   GET    → serwuje zdjęcie galerii z bazy (BYTEA). Publiczne.
//            Dla zdjęć zewnętrznych (link) — przekierowanie 302.
//   DELETE → usunięcie jednego zdjęcia z galerii (tylko admin).
// Obsługa pojedynczego zdjęcia jest tu połączona z kolekcją, żeby zmniejszyć
// liczbę funkcji serverless (limit 12 na planie Hobby na Vercelu).
const {
  sql, ensureSchema, requireAuth, readJson, wrap,
  addPhoto, listPhotos, setPhotoOrder, syncMainImage, deletePhoto,
} = require('./_lib');

const MAX_PHOTOS = 8;

module.exports = wrap(async function handler(req, res) {
  await ensureSchema();

  const id = req.query && req.query.id ? String(req.query.id) : '';

  // ---- Operacje na pojedynczym zdjęciu: /api/photos/:id ----
  if (id) {
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
  }

  // ---- Operacje na kolekcji: /api/photos (tylko admin) ----
  if (!requireAuth(req, res)) return;

  if (req.method === 'POST') {
    const body = await readJson(req);
    const productId = String(body.productId || '').trim();
    const img = body.img;
    if (!productId) return res.status(400).json({ error: 'Brak identyfikatora produktu.' });
    if (!img) return res.status(400).json({ error: 'Brak zdjęcia do dodania.' });

    const exists = await sql`SELECT 1 FROM products WHERE id = ${productId};`;
    if (!exists.rows.length) return res.status(404).json({ error: 'Nie znaleziono produktu.' });

    const cnt = await sql`SELECT COUNT(*)::int AS n FROM product_photos WHERE product_id = ${productId};`;
    if (cnt.rows[0].n >= MAX_PHOTOS) {
      return res.status(400).json({ error: `Limit ${MAX_PHOTOS} zdjęć na produkt został osiągnięty.` });
    }

    const photo = await addPhoto(productId, img);
    const mainImg = await syncMainImage(productId);
    const photos = await listPhotos(productId);
    return res.status(201).json({ ok: true, id: photo.id, url: photo.url, img: mainImg, photos });
  }

  if (req.method === 'PUT') {
    const body = await readJson(req);
    const productId = String(body.productId || '').trim();
    if (!productId) return res.status(400).json({ error: 'Brak identyfikatora produktu.' });
    if (!Array.isArray(body.order)) return res.status(400).json({ error: 'Pole „order" musi być listą.' });

    await setPhotoOrder(productId, body.order.map(String));
    const img = await syncMainImage(productId);
    const photos = await listPhotos(productId);
    return res.status(200).json({ ok: true, img, photos });
  }

  res.setHeader('Allow', 'POST, PUT');
  return res.status(405).json({ error: 'Method not allowed' });
});
