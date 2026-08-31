// /api/products
//   GET  → publiczna lista wszystkich produktów (używana przez sklep)
//   POST → dodanie nowego produktu (tylko admin)
const {
  sql, ensureSchema, rowToProduct, requireAuth, readJson, wrap,
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

  const cat = CATS.includes(body.cat) ? body.cat : 'wood';
  const art = ARTS.includes(body.art) ? body.art : (cat === 'wood' ? 'w1' : 'a1');
  const price = Math.max(0, Math.round(Number(body.price) || 0));
  const descr = String(body.desc || '').trim();
  const img = String(body.img || '').trim();
  const tag = String(body.tag || '').trim();

  let id = String(body.id || '').trim();
  if (!id && requireId) id = slugify(name);
  if (requireId && !id) return { error: 'Nie udało się utworzyć identyfikatora (id) z nazwy.' };

  return { data: { id, name, cat, tag, price, descr, art, img } };
}

module.exports = wrap(async function handler(req, res) {
  await ensureSchema();

  if (req.method === 'GET') {
    const { rows } = await sql`SELECT * FROM products ORDER BY sort_order ASC, created_at ASC;`;
    return res.status(200).json(rows.map(rowToProduct));
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

    const { rows } = await sql`
      INSERT INTO products (id, name, cat, tag, price, descr, art, img, sort_order)
      VALUES (${data.id}, ${data.name}, ${data.cat}, ${data.tag}, ${data.price},
              ${data.descr}, ${data.art}, ${data.img}, ${sortOrder})
      RETURNING *;
    `;
    return res.status(201).json(rowToProduct(rows[0]));
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
});

module.exports.validate = validate;
module.exports.slugify = slugify;
