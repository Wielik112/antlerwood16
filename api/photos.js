// /api/photos  (tylko admin)
//   POST { productId, img }        → dodaj zdjęcie do galerii produktu
//                                    (img = data URL wgranego pliku lub zwykły link)
//   PUT  { productId, order:[ids] } → ustaw kolejność zdjęć (pierwsze = główne)
const {
  sql, ensureSchema, requireAuth, readJson, wrap,
  addPhoto, listPhotos, setPhotoOrder, syncMainImage,
} = require('./_lib');

const MAX_PHOTOS = 8;

module.exports = wrap(async function handler(req, res) {
  await ensureSchema();
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
