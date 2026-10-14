// /api/products
//   GET  → publiczna lista wszystkich produktów (używana przez sklep)
//   POST → dodanie nowego produktu (tylko admin)
// /api/products/:id  (vercel.json przepisuje na /api/products?id=:id)
//   GET    → jeden produkt (publiczny, używany przez stronę produktu)
//   PUT    → edycja produktu (tylko admin)
//   DELETE → usunięcie produktu (tylko admin)
// Obsługa pojedynczego produktu jest tu połączona z listą, żeby zmniejszyć
// liczbę funkcji serverless (limit 12 na planie Hobby na Vercelu).
const {
  sql, ensureSchema, rowToProduct, requireAuth, readJson, wrap,
  addPhoto, syncMainImage, attachPhotos, isDataUrl, translateDescriptions,
} = require('./_lib');

const CATS = ['wood', 'antler'];
const ARTS = ['w1', 'w2', 'w3', 'a1', 'a2', 'a3', 'centerpc'];

// Zamień nazwę na bezpieczne id (slug): małe litery, myślniki, bez polskich znaków.
function slugify(s) {
  const map = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };
  return String(s || '')
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (c) => map[c] || c)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// Sprawdź i znormalizuj dane wejściowe produktu. Zwraca { data } lub { error }.
function validate(body, { requireId } = {}) {
  const name = String(body.name || '').trim();
  if (!name) return { error: 'Pole „nazwa" jest wymagane.' };
  const nameEn = String(body.nameEn || '').trim();
  const nameDe = String(body.nameDe || '').trim();

  const cat = CATS.includes(body.cat) ? body.cat : 'wood';
  const art = ARTS.includes(body.art) ? body.art : (cat === 'wood' ? 'w1' : 'a1');
  const price = Math.max(0, Math.round(Number(body.price) || 0));
  const descr = String(body.desc || '').trim();       // opis główny (krótki)
  const descFull = String(body.descFull || '').trim(); // opis produktu (pełny)
  // Tłumaczenia przysłane z panelu (tłumaczone w przeglądarce admina). Opcjonalne.
  const descEn = String(body.descEn || '').trim();
  const descDe = String(body.descDe || '').trim();
  const descFullEn = String(body.descFullEn || '').trim();
  const descFullDe = String(body.descFullDe || '').trim();
  const img = String(body.img || '').trim();
  const tag = String(body.tag || '').trim();

  // ilość sztuk (domyślnie 1) oraz wymiary w cm (opcjonalne)
  const numOrNull = (v) => {
    if (v === '' || v == null) return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  };
  const stock = (body.stock === '' || body.stock == null)
    ? 1 : Math.max(0, Math.round(Number(body.stock)) || 0);
  const dimH = numOrNull(body.dimH);
  const dimW = numOrNull(body.dimW);
  const dimD = numOrNull(body.dimD);

  let id = String(body.id || '').trim();
  if (!id && requireId) id = slugify(name);
  if (requireId && !id) return { error: 'Nie udało się utworzyć identyfikatora (id) z nazwy.' };

  return { data: { id, name, nameEn, nameDe, cat, tag, price, descr, descFull, art, img, stock, dimH, dimW, dimD,
    descEn, descDe, descFullEn, descFullDe } };
}

// Ustal ostateczne tłumaczenia: 1) z panelu (MyMemory), 2) serwerowo DeepL (jeśli
// jest klucz) tam, gdzie brak, 3) ostatecznie tekst polski (żeby nie zapisać pustych).
async function resolveTranslations(data) {
  let { descEn, descDe, descFullEn, descFullDe } = data;
  if (!descEn || !descDe || !descFullEn || !descFullDe) {
    const s = await translateDescriptions(data.descr, data.descFull);
    descEn = descEn || s.descEn;
    descDe = descDe || s.descDe;
    descFullEn = descFullEn || s.descFullEn;
    descFullDe = descFullDe || s.descFullDe;
  }
  return {
    descEn: descEn || data.descr,
    descDe: descDe || data.descr,
    descFullEn: descFullEn || data.descFull,
    descFullDe: descFullDe || data.descFull,
  };
}

module.exports = wrap(async function handler(req, res) {
  await ensureSchema();

  const id = req.query && req.query.id ? String(req.query.id) : '';

  // ---- Operacje na pojedynczym produkcie: /api/products/:id ----
  if (id) {
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

      // Tłumaczenia opisów: z panelu (MyMemory) → DeepL (jeśli klucz) → fallback PL.
      const tr = await resolveTranslations(data);

      // Zdjęcie główne (products.img) jest wyliczane z galerii — nie nadpisujemy go tutaj
      // danymi tekstowymi formularza. Aktualizujemy tylko pozostałe pola produktu.
      const { rows } = await sql`
        UPDATE products SET
          name = ${data.name},
          name_en = ${data.nameEn || data.name},
          name_de = ${data.nameDe || data.name},
          cat = ${data.cat},
          tag = ${data.tag},
          price = ${data.price},
          descr = ${data.descr},
          desc_full = ${data.descFull},
          descr_en = ${tr.descEn},
          descr_de = ${tr.descDe},
          desc_full_en = ${tr.descFullEn},
          desc_full_de = ${tr.descFullDe},
          stock = ${data.stock},
          dim_h = ${data.dimH},
          dim_w = ${data.dimW},
          dim_d = ${data.dimD},
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
  }

  // ---- Operacje na kolekcji: /api/products ----
  if (req.method === 'GET') {
    const { rows } = await sql`SELECT * FROM products ORDER BY sort_order ASC, created_at ASC;`;
    const products = await attachPhotos(rows.map(rowToProduct));
    return res.status(200).json(products);
  }

  if (req.method === 'POST') {
    if (!requireAuth(req, res)) return;
    const body = await readJson(req);
    const { data, error } = validate(body, { requireId: true });
    if (error) return res.status(400).json({ error });

    const exists = await sql`SELECT 1 FROM products WHERE id = ${data.id};`;
    if (exists.rows.length) {
      return res.status(409).json({ error: `Produkt o id „${data.id}" już istnieje.` });
    }

    const ord = await sql`SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM products;`;
    const sortOrder = ord.rows[0].next;

    // Tłumaczenia opisów: z panelu (MyMemory) → DeepL (jeśli klucz) → fallback PL.
    const tr = await resolveTranslations(data);

    // Produkt tworzymy z pustym img — zdjęcie(a) trafiają do galerii (product_photos),
    // a products.img jest z niej wyliczane (pierwsze zdjęcie = główne).
    const { rows } = await sql`
      INSERT INTO products (id, name, name_en, name_de, cat, tag, price, descr, desc_full, art, img, sort_order,
        descr_en, descr_de, desc_full_en, desc_full_de, stock, dim_h, dim_w, dim_d)
      VALUES (${data.id}, ${data.name}, ${data.nameEn || data.name}, ${data.nameDe || data.name},
              ${data.cat}, ${data.tag}, ${data.price},
              ${data.descr}, ${data.descFull}, ${data.art}, '', ${sortOrder},
              ${tr.descEn}, ${tr.descDe}, ${tr.descFullEn}, ${tr.descFullDe},
              ${data.stock}, ${data.dimH}, ${data.dimW}, ${data.dimD})
      RETURNING *;
    `;
    let row = rows[0];

    // Zgodność wstecz: jeśli w payloadzie przyszło pojedyncze zdjęcie (link lub wgrany plik),
    // dodajemy je jako pierwsze zdjęcie galerii. Panel admina zwykle dosyła zdjęcia osobno.
    if (data.img) {
      await addPhoto(data.id, data.img, 0);
      await syncMainImage(data.id);
      const upd = await sql`SELECT * FROM products WHERE id = ${data.id};`;
      row = upd.rows[0];
    }
    const [product] = await attachPhotos([rowToProduct(row)]);
    return res.status(201).json(product);
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
});

module.exports.validate = validate;
module.exports.slugify = slugify;
