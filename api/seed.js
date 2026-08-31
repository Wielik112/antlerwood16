// POST /api/seed  (tylko admin)
// Wgrywa startowe 9 produktów do bazy — używane raz, przy pierwszym uruchomieniu.
// Domyślnie nie nadpisuje istniejących danych (bezpieczne do ponownego wywołania).
// Aby wymusić nadpisanie: POST /api/seed { "force": true }
const {
  sql, ensureSchema, rowToProduct, requireAuth, readJson,
} = require('./_lib');

// Te same produkty co startowe w js/main.js (fallback frontendu).
const SEED = [
  { id: 'polka-dab', name: 'Półka z litego dębu', cat: 'wood', art: 'w1', tag: 'Lite drewno', price: 590, desc: 'Masywna półka ścienna z naturalnym rysunkiem słojów, olejowana ręcznie.', img: 'https://images.unsplash.com/photo-1594026112284-02bb6f3352fe?w=800&q=80&auto=format&fit=crop' },
  { id: 'stol-plaster', name: 'Stół z plastra drewna', cat: 'wood', art: 'w2', tag: 'Lite drewno', price: 2400, desc: 'Blat z pojedynczego plastra pnia, surowa krawędź, stalowe nogi.', img: 'https://images.unsplash.com/photo-1533090161767-e6ffed986c88?w=800&q=80&auto=format&fit=crop' },
  { id: 'wieszak-deska', name: 'Wieszak deska i poroże', cat: 'antler', art: 'a1', tag: 'Poroże', price: 340, desc: 'Deska z litego drewna z autentycznym porożem jako haki. Jeden egzemplarz.', img: 'https://images.unsplash.com/photo-1509660933844-6910e12765a0?w=800&q=80&auto=format&fit=crop' },
  { id: 'komoda', name: 'Komoda rustykalna', cat: 'wood', art: 'w3', tag: 'Lite drewno', price: 3200, desc: 'Komoda z litego drewna z akcentem poroża przy uchwytach.', img: 'https://images.unsplash.com/photo-1595428774223-ef52624120d2?w=800&q=80&auto=format&fit=crop' },
  { id: 'stojak-noze', name: 'Stojak na noże z poroża', cat: 'antler', art: 'a2', tag: 'Poroże', price: 420, desc: 'Specjalistyczny ekspozytor kolekcjonerski na noże z naturalnego poroża.', img: 'https://images.unsplash.com/photo-1593618998160-e34014e67546?w=800&q=80&auto=format&fit=crop' },
  { id: 'organizer', name: 'Organizer na biżuterię', cat: 'antler', art: 'a3', tag: 'Poroże', price: 210, desc: 'Stojak na pierścionki i klucze z rozgałęzień poroża na drewnianej bazie.', img: 'https://images.unsplash.com/photo-1602173574767-37ac01994b2a?w=800&q=80&auto=format&fit=crop' },
  { id: 'wieszak-galaz', name: 'Wieszak z gałęzi', cat: 'wood', art: 'w1', tag: 'Lite drewno', price: 260, desc: 'Wieszak z przepołowionej naturalnej gałęzi, surowy, organiczny kształt.', img: 'https://images.unsplash.com/photo-1567016432779-094069958ea5?w=800&q=80&auto=format&fit=crop' },
  { id: 'ekspozytor-miecze', name: 'Ekspozytor na miecze', cat: 'antler', art: 'centerpc', tag: 'Poroże', price: 680, desc: 'Unikalny wieszak na miecze z poroża, mocny akcent w rustykalnym wnętrzu.', img: 'https://images.unsplash.com/photo-1520697830682-bbb6e85e2b0b?w=800&q=80&auto=format&fit=crop' },
  { id: 'stolek-poroze', name: 'Stołek z poroża', cat: 'antler', art: 'a2', tag: 'Poroże', price: 1150, desc: 'Stołek wykonany w całości z użyciem poroża, rzeźbiarska forma użytkowa.', img: 'https://images.unsplash.com/photo-1503602642458-232111445657?w=800&q=80&auto=format&fit=crop' },
];

module.exports = async function handler(req, res) {
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
};
