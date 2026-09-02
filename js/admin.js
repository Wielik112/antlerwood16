/* Panel admina Antlerwood — logika (czysty JS, bez frameworków).
   Rozmawia z backendem (Vercel Functions):
     GET  /api/session          – czy zalogowany
     POST /api/login {password} – logowanie
     POST /api/logout           – wylogowanie
     GET  /api/products         – lista
     POST /api/products         – dodanie
     PUT  /api/products/:id      – edycja
     DELETE /api/products/:id    – usunięcie
     POST /api/seed             – import startowych produktów
   Ciasteczko sesji jest HttpOnly i wysyłane automatycznie (same-origin). */

const $ = (id) => document.getElementById(id);

const el = {
  loginScreen: $('loginScreen'),
  loginForm: $('loginForm'),
  pw: $('pw'),
  panel: $('panel'),
  topActions: $('topActions'),
  logoutBtn: $('logoutBtn'),
  productForm: $('productForm'),
  editingId: $('editingId'),
  formTitle: $('formTitle'),
  cancelEdit: $('cancelEdit'),
  saveBtn: $('saveBtn'),
  plist: $('plist'),
  count: $('count'),
  reloadBtn: $('reloadBtn'),
  seedBox: $('seedBox'),
  seedBtn: $('seedBtn'),
  msg: $('msg'),
  ordersBox: $('ordersBox'),
  ordersCount: $('ordersCount'),
  ordersReload: $('ordersReload'),
};

const f = {
  name: $('f-name'), cat: $('f-cat'), price: $('f-price'),
  desc: $('f-desc'), descFull: $('f-descfull'), art: $('f-art'), id: $('f-id'),
};
const gal = {
  main: $('galMain'),
  thumbs: $('galThumbs'),
  files: $('f-files'),
  hint: $('galHint'),
  urlInput: $('f-imgurl'),
  addUrlBtn: $('addUrlBtn'),
};

const MAX_PHOTOS = 8;

let PRODUCTS = [];

// ---------- Stan galerii w formularzu ----------
// gallery: uporządkowana lista zdjęć. Pierwsze = główne. Każdy element:
//   { key, id, url, dataUrl }
//     id      – identyfikator zdjęcia na serwerze (null dla nowego, niezapisanego)
//     url     – adres do podglądu (serwerowy lub data URL / link)
//     dataUrl – dane wgranego pliku do wysłania (tylko nowe wgrane pliki)
let gallery = [];
let originalIds = []; // id zdjęć wczytanych z serwera (do wykrycia usunięć przy zapisie)
let galKeySeq = 0;
const nextKey = () => `g${++galKeySeq}`;

/* ---------- pomocnicze ---------- */
function toast(text, type) {
  el.msg.textContent = (text == null) ? '' : String(text);
  el.msg.className = 'show ' + (type || '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.msg.className = ''; }, 3200);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    ...opts,
  });
  // Odczytaj treść jako tekst, a potem spróbuj sparsować JSON — dzięki temu
  // nawet gdy serwer zwróci nie-JSON (np. surowy błąd 500), pokażemy sensowny komunikat.
  const raw = await res.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch (e) { /* nie-JSON */ }

  if (!res.ok) {
    let msg;
    if (data && typeof data.error === 'string') msg = data.error;
    else if (data && data.error) msg = JSON.stringify(data.error);
    else if (raw) msg = raw.slice(0, 300);
    else msg = `Błąd ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function fmtPrice(v) { return Number(v || 0).toLocaleString('pl-PL') + ' zł'; }

/* ---------- zdjęcie: kompresja w przeglądarce + podgląd ---------- */
// Wczytaj plik, pomniejsz do maxDim i wyeksportuj jako JPEG data URL.
// Jeśli wynik dalej za duży, obniż jakość/rozmiar.
function compressImage(file, maxDim = 1400, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = image;
      if (width > maxDim || height > maxDim) {
        const s = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * s);
        height = Math.round(height * s);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; // tło pod ewentualną przezroczystość (PNG → JPEG)
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0, width, height);
      let out = canvas.toDataURL('image/jpeg', quality);
      // twardy limit ~3.5 MB — jak trzeba, spróbuj mocniej skompresować
      if (out.length > 3.5 * 1024 * 1024) {
        const c2 = document.createElement('canvas');
        const s2 = Math.min(1000 / width, 1000 / height, 1);
        c2.width = Math.round(width * s2); c2.height = Math.round(height * s2);
        const x2 = c2.getContext('2d');
        x2.fillStyle = '#ffffff'; x2.fillRect(0, 0, c2.width, c2.height);
        x2.drawImage(image, 0, 0, c2.width, c2.height);
        out = c2.toDataURL('image/jpeg', 0.7);
      }
      resolve(out);
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Nie udało się wczytać obrazu.')); };
    image.src = url;
  });
}

/* ---------- galeria: renderowanie ---------- */
function cssUrl(src) { return `url('${String(src).replace(/'/g, "\\'")}')`; }

function renderGallery() {
  // duże zdjęcie główne = pierwszy element
  const main = gallery[0];
  if (main) {
    gal.main.style.backgroundImage = cssUrl(main.url);
    gal.main.innerHTML = '<span class="gallery-main-badge">Główne</span>';
  } else {
    gal.main.style.backgroundImage = '';
    gal.main.innerHTML = '<span class="ph">Brak zdjęć — dodaj pierwsze poniżej</span>';
  }

  // miniaturki
  const thumbs = gallery.map((item) => `
    <div class="gthumb${item === main ? ' is-main' : ''}" data-key="${item.key}"
         title="${item === main ? 'Zdjęcie główne' : 'Kliknij, aby ustawić jako główne'}"
         style="background-image:${cssUrl(item.url)}" tabindex="0">
      <button type="button" class="del" data-key="${item.key}" title="Usuń zdjęcie" aria-label="Usuń zdjęcie">×</button>
      <span class="star" aria-hidden="true">★</span>
    </div>`).join('');

  const canAdd = gallery.length < MAX_PHOTOS;
  const addTile = canAdd
    ? '<div class="gthumb add" id="galAddTile" title="Dodaj zdjęcia" tabindex="0">+</div>'
    : '';
  gal.thumbs.innerHTML = thumbs + addTile;

  // zdarzenia miniaturek
  gal.thumbs.querySelectorAll('.gthumb:not(.add)').forEach((node) => {
    const key = node.getAttribute('data-key');
    node.addEventListener('click', (e) => {
      if (e.target.closest('.del')) return; // klik w „×" obsłużony niżej
      setMain(key);
    });
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMain(key); }
    });
  });
  gal.thumbs.querySelectorAll('.del').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); removePhoto(btn.getAttribute('data-key')); });
  });
  const addTileEl = $('galAddTile');
  if (addTileEl) addTileEl.addEventListener('click', () => gal.files.click());
}

// przenieś wybrane zdjęcie na początek (= główne)
function setMain(key) {
  const idx = gallery.findIndex((x) => x.key === key);
  if (idx <= 0) return;
  const [item] = gallery.splice(idx, 1);
  gallery.unshift(item);
  renderGallery();
}

function removePhoto(key) {
  gallery = gallery.filter((x) => x.key !== key);
  renderGallery();
}

function addGalleryItem({ id = null, url, dataUrl = null }) {
  if (gallery.length >= MAX_PHOTOS) {
    toast(`Można dodać maksymalnie ${MAX_PHOTOS} zdjęć.`, 'err');
    return false;
  }
  gallery.push({ key: nextKey(), id, url, dataUrl });
  return true;
}

/* ---------- galeria: dodawanie plików / URL ---------- */
gal.files.addEventListener('change', async () => {
  const files = Array.from(gal.files.files || []);
  gal.files.value = ''; // pozwól wybrać te same pliki ponownie
  if (!files.length) return;

  gal.hint.textContent = 'Przetwarzam zdjęcia…';
  gal.hint.classList.add('uploading');
  let added = 0;
  try {
    for (const file of files) {
      if (gallery.length >= MAX_PHOTOS) { toast(`Limit ${MAX_PHOTOS} zdjęć osiągnięty.`, 'err'); break; }
      if (!/^image\//.test(file.type)) { toast(`Pominięto „${file.name}" — to nie obraz.`, 'err'); continue; }
      const dataUrl = await compressImage(file);
      if (addGalleryItem({ url: dataUrl, dataUrl })) added += 1;
    }
    renderGallery();
    gal.hint.textContent = added
      ? `Dodano ${added} zdjęć. Kliknij „Zapisz produkt", aby zapisać.`
      : 'Nie dodano żadnego zdjęcia.';
  } catch (err) {
    toast(err.message, 'err');
    gal.hint.textContent = 'Nie udało się przetworzyć pliku.';
  } finally {
    gal.hint.classList.remove('uploading');
  }
});

gal.addUrlBtn.addEventListener('click', () => {
  const v = gal.urlInput.value.trim();
  if (!v) { toast('Wpisz adres zdjęcia.', 'err'); return; }
  if (addGalleryItem({ url: v, dataUrl: null })) {
    gal.urlInput.value = '';
    renderGallery();
    toast('Dodano zdjęcie z adresu URL.', 'ok');
  }
});

/* ---------- sesja ---------- */
async function checkSession() {
  try {
    const s = await api('/api/session');
    if (s && s.authed) return showPanel();
  } catch (e) { /* pokaż logowanie */ }
  showLogin();
}
function showLogin() {
  el.loginScreen.classList.remove('hidden');
  el.panel.classList.add('hidden');
  el.topActions.classList.add('hidden');
  el.pw.focus();
}
async function showPanel() {
  el.loginScreen.classList.add('hidden');
  el.panel.classList.remove('hidden');
  el.topActions.classList.remove('hidden');
  await loadProducts();
  loadOrders();
}

el.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ password: el.pw.value }) });
    el.pw.value = '';
    toast('Zalogowano.', 'ok');
    showPanel();
  } catch (err) {
    toast(err.message, 'err');
  }
});

el.logoutBtn.addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch (e) {}
  toast('Wylogowano.', 'ok');
  showLogin();
});

/* ---------- lista produktów ---------- */
async function loadProducts() {
  try {
    PRODUCTS = await api('/api/products');
  } catch (err) {
    toast('Nie udało się pobrać produktów: ' + err.message, 'err');
    PRODUCTS = [];
  }
  renderList();
}

function renderList() {
  el.count.textContent = PRODUCTS.length;
  el.seedBox.classList.toggle('hidden', PRODUCTS.length > 0);

  el.plist.innerHTML = PRODUCTS.map((p) => {
    const bg = p.img ? `background-image:url('${escapeHtml(p.img)}')` : '';
    const catLabel = p.cat === 'wood' ? 'Lite drewno' : 'Poroże';
    const nPhotos = Array.isArray(p.images) ? p.images.length : (p.img ? 1 : 0);
    const photoBadge = nPhotos > 1 ? ` · <span class="badge">${nPhotos} zdj.</span>` : '';
    return `<div class="pitem" data-id="${escapeHtml(p.id)}">
      <div class="pthumb" style="${bg}"></div>
      <div class="pmeta">
        <b>${escapeHtml(p.name)}</b>
        <span class="sub">${fmtPrice(p.price)} · <span class="badge">${catLabel}</span>${photoBadge} · <code>${escapeHtml(p.id)}</code></span>
      </div>
      <div class="pactions">
        <button class="btn secondary small" data-act="edit">Edytuj</button>
        <button class="btn danger small" data-act="del">Usuń</button>
      </div>
    </div>`;
  }).join('');

  el.plist.querySelectorAll('.pitem').forEach((row) => {
    const id = row.getAttribute('data-id');
    row.querySelector('[data-act="edit"]').addEventListener('click', () => startEdit(id));
    row.querySelector('[data-act="del"]').addEventListener('click', () => remove(id));
  });
}

/* ---------- formularz: dodawanie / edycja ---------- */
function fillForm(p) {
  f.name.value = p.name || '';
  f.cat.value = p.cat || 'wood';
  f.price.value = p.price != null ? p.price : '';
  f.desc.value = p.desc || '';
  f.descFull.value = p.descFull || '';
  f.art.value = p.art || 'w1';
  f.id.value = p.id || '';

  // galeria: wczytaj zdjęcia produktu (pierwsze = główne)
  gallery = [];
  originalIds = [];
  const photos = Array.isArray(p.photos) ? p.photos : [];
  if (photos.length) {
    for (const ph of photos) {
      gallery.push({ key: nextKey(), id: ph.id || null, url: ph.url, dataUrl: null });
      if (ph.id) originalIds.push(ph.id);
    }
  } else if (p.img) {
    // produkt bez galerii, ale z pojedynczym zdjęciem (np. startowe z linkiem)
    gallery.push({ key: nextKey(), id: null, url: p.img, dataUrl: null });
  }
  gal.urlInput.value = '';
  renderGallery();
}
function clearForm() {
  el.editingId.value = '';
  el.productForm.reset();
  f.art.value = 'w1';
  el.formTitle.textContent = 'Dodaj produkt';
  el.saveBtn.textContent = 'Zapisz produkt';
  el.cancelEdit.classList.add('hidden');
  f.id.removeAttribute('readonly');
  // reset galerii
  gallery = [];
  originalIds = [];
  gal.urlInput.value = '';
  renderGallery();
  gal.hint.textContent = 'Pierwsze zdjęcie jest głównym. Kliknij miniaturkę, aby ustawić ją jako '
    + 'główną. Możesz wgrać kilka plików naraz (JPG/PNG) — zostaną pomniejszone i zapisane w bazie.';
}
function startEdit(id) {
  const p = PRODUCTS.find((x) => x.id === id);
  if (!p) return;
  el.editingId.value = id;
  fillForm(p);
  f.id.setAttribute('readonly', 'readonly'); // id nie zmieniamy przy edycji
  el.formTitle.textContent = 'Edytuj produkt';
  el.saveBtn.textContent = 'Zapisz zmiany';
  el.cancelEdit.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
el.cancelEdit.addEventListener('click', clearForm);

// Uzgodnij galerię na serwerze z bieżącym stanem edytora:
// 1) usuń skasowane zdjęcia, 2) dodaj nowe (w kolejności), 3) ustaw finalną kolejność.
async function syncGallery(productId) {
  const currentIds = gallery.filter((x) => x.id).map((x) => x.id);
  const toDelete = originalIds.filter((id) => !currentIds.includes(id));
  for (const id of toDelete) {
    await api('/api/photos/' + encodeURIComponent(id), { method: 'DELETE' });
  }
  for (const item of gallery) {
    if (item.id) continue; // już zapisane
    const img = item.dataUrl || item.url;
    const r = await api('/api/photos', {
      method: 'POST', body: JSON.stringify({ productId, img }),
    });
    item.id = r.id;
  }
  const order = gallery.map((x) => x.id).filter(Boolean);
  if (order.length) {
    await api('/api/photos', { method: 'PUT', body: JSON.stringify({ productId, order }) });
  }
}

el.productForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    name: f.name.value.trim(),
    cat: f.cat.value,
    price: Number(f.price.value) || 0,
    desc: f.desc.value.trim(),
    descFull: f.descFull.value.trim(),
    art: f.art.value,
    id: f.id.value.trim(),
  };
  if (!payload.name) { toast('Podaj nazwę produktu.', 'err'); return; }

  const editingId = el.editingId.value;
  el.saveBtn.disabled = true;
  el.saveBtn.textContent = 'Zapisywanie…';
  try {
    let productId = editingId;
    if (editingId) {
      await api('/api/products/' + encodeURIComponent(editingId), {
        method: 'PUT', body: JSON.stringify(payload),
      });
    } else {
      const created = await api('/api/products', { method: 'POST', body: JSON.stringify(payload) });
      productId = created.id;
    }
    await syncGallery(productId);
    toast(editingId ? 'Zapisano zmiany.' : 'Dodano produkt.', 'ok');
    clearForm();
    await loadProducts();
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    el.saveBtn.disabled = false;
    el.saveBtn.textContent = el.editingId.value ? 'Zapisz zmiany' : 'Zapisz produkt';
  }
});

async function remove(id) {
  const p = PRODUCTS.find((x) => x.id === id);
  if (!confirm(`Usunąć produkt „${p ? p.name : id}"? Tej operacji nie można cofnąć.`)) return;
  try {
    await api('/api/products/' + encodeURIComponent(id), { method: 'DELETE' });
    toast('Usunięto produkt.', 'ok');
    if (el.editingId.value === id) clearForm();
    await loadProducts();
  } catch (err) {
    toast(err.message, 'err');
  }
}

/* ---------- import startowych ---------- */
el.seedBtn.addEventListener('click', async () => {
  el.seedBtn.disabled = true;
  try {
    await api('/api/seed', { method: 'POST', body: JSON.stringify({}) });
    toast('Zaimportowano produkty startowe.', 'ok');
    await loadProducts();
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    el.seedBtn.disabled = false;
  }
});

el.reloadBtn.addEventListener('click', loadProducts);

/* ---------- zamówienia (Stripe) ---------- */
function fmtGrosze(v, cur) {
  const amount = Number(v || 0) / 100;
  const c = String(cur || 'pln').toUpperCase();
  if (c === 'PLN') return amount.toLocaleString('pl-PL') + ' zł';
  return amount.toLocaleString('pl-PL') + ' ' + c;
}
function fmtDate(s) {
  try { return new Date(s).toLocaleString('pl-PL'); } catch (e) { return String(s || ''); }
}

async function loadOrders() {
  if (!el.ordersBox) return;
  try {
    const orders = await api('/api/orders');
    renderOrders(Array.isArray(orders) ? orders : []);
  } catch (err) {
    if (el.ordersCount) el.ordersCount.textContent = '0';
    el.ordersBox.innerHTML = `<p class="hint">Nie udało się pobrać zamówień: ${escapeHtml(err.message)}</p>`;
  }
}

function renderOrders(orders) {
  if (el.ordersCount) el.ordersCount.textContent = String(orders.length);
  if (!orders.length) {
    el.ordersBox.innerHTML = '<p class="hint">Brak zamówień. Pojawią się tu po pierwszej udanej płatności.</p>';
    return;
  }
  el.ordersBox.innerHTML = orders.map((o) => {
    const items = (Array.isArray(o.items) ? o.items : [])
      .map((it) => `${escapeHtml(it.name)} × ${it.qty}`).join(', ');
    const ship = o.shipping && o.shipping.address ? o.shipping.address : null;
    const shipLine = ship
      ? [ship.line1, ship.line2, `${ship.postal_code || ''} ${ship.city || ''}`.trim(), ship.country]
        .filter(Boolean).map(escapeHtml).join(', ')
      : '';
    return `<div class="order-row" style="border:1px solid var(--line,#333);border-radius:12px;padding:14px 16px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:baseline">
        <strong>${fmtGrosze(o.amount_total, o.currency)}</strong>
        <span class="hint">${fmtDate(o.created_at)}</span>
      </div>
      <div class="hint" style="margin-top:6px">${escapeHtml(o.customer_name || '')}${o.email ? ' · ' + escapeHtml(o.email) : ''}</div>
      <div style="margin-top:6px">${escapeHtml(items)}</div>
      ${shipLine ? `<div class="hint" style="margin-top:6px">Wysyłka: ${shipLine}</div>` : ''}
      <div class="hint" style="margin-top:6px;opacity:.6;font-size:.82em">${escapeHtml(o.status)} · ${escapeHtml(o.id)}</div>
    </div>`;
  }).join('');
}

if (el.ordersReload) el.ordersReload.addEventListener('click', loadOrders);

/* start */
renderGallery();   // pokaż pusty edytor galerii (kafel „+")
checkSession();
