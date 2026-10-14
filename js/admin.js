/* Panel admina Antlerwood — logika (czysty JS, bez frameworków).
   Backend (Vercel Functions), adresy zachowane przez rewrites w vercel.json:
     GET  /api/session          – czy zalogowany
     POST /api/login {password} – logowanie
     POST /api/logout           – wylogowanie
     GET  /api/products         – lista
     POST /api/products         – dodanie
     PUT  /api/products/:id      – edycja
     DELETE /api/products/:id    – usunięcie
     POST /api/photos … PUT/DELETE – galeria zdjęć
     GET  /api/orders           – zamówienia (Stripe)
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
  // nawigacja / widoki
  navProducts: $('navProducts'),
  navOrders: $('navOrders'),
  // produkty
  productForm: $('productForm'),
  editingId: $('editingId'),
  formTitle: $('formTitle'),
  cancelEdit: $('cancelEdit'),
  saveBtn: $('saveBtn'),
  plist: $('plist'),
  tableWrap: $('tableWrap'),
  prodEmpty: $('prodEmpty'),
  prodSearch: $('prodSearch'),
  addProductBtn: $('addProductBtn'),
  reloadBtn: $('reloadBtn'),
  seedBox: $('seedBox'),
  seedBtn: $('seedBtn'),
  // modal
  productModal: $('productModal'),
  modalClose: $('modalClose'),
  // zamówienia
  ordersBox: $('ordersBox'),
  orderSearch: $('orderSearch'),
  ordersReload: $('ordersReload'),
  dashOrders: $('dashOrders'),
  dashReload: $('dashReload'),
  // statystyki
  statProducts: $('statProducts'),
  statOrders: $('statOrders'),
  statRevenue: $('statRevenue'),
  statAvg: $('statAvg'),
  msg: $('msg'),
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
let ORDERS = [];

// ---------- Stan galerii w formularzu ----------
let gallery = [];
let originalIds = [];
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
function fmtGrosze(v, cur) {
  const amount = Number(v || 0) / 100;
  const c = String(cur || 'pln').toUpperCase();
  if (c === 'PLN') return amount.toLocaleString('pl-PL', { maximumFractionDigits: 2 }) + ' zł';
  return amount.toLocaleString('pl-PL', { maximumFractionDigits: 2 }) + ' ' + c;
}
function fmtDate(s) {
  try { return new Date(s).toLocaleString('pl-PL'); } catch (e) { return String(s || ''); }
}

/* ---------- przełączanie widoków ---------- */
function switchView(name) {
  document.querySelectorAll('.view').forEach((v) => {
    v.classList.toggle('hidden', v.id !== 'view-' + name);
  });
  document.querySelectorAll('.nav-item').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-view') === name);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
document.querySelectorAll('.nav-item').forEach((b) => {
  b.addEventListener('click', () => switchView(b.getAttribute('data-view')));
});
document.querySelectorAll('[data-goto]').forEach((b) => {
  b.addEventListener('click', () => switchView(b.getAttribute('data-goto')));
});

/* ---------- zdjęcie: kompresja w przeglądarce + podgląd ---------- */
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
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0, width, height);
      let out = canvas.toDataURL('image/jpeg', quality);
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
  const main = gallery[0];
  if (main) {
    gal.main.style.backgroundImage = cssUrl(main.url);
    gal.main.innerHTML = '<span class="gallery-main-badge">Główne</span>';
  } else {
    gal.main.style.backgroundImage = '';
    gal.main.innerHTML = '<span class="ph">Brak zdjęć — dodaj pierwsze poniżej</span>';
  }

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

  gal.thumbs.querySelectorAll('.gthumb:not(.add)').forEach((node) => {
    const key = node.getAttribute('data-key');
    node.addEventListener('click', (e) => {
      if (e.target.closest('.del')) return;
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
  gal.files.value = '';
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
  switchView('dashboard');
  await loadProducts();
  await loadOrders();
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
  renderStats();
}

function renderList() {
  if (el.navProducts) el.navProducts.textContent = String(PRODUCTS.length);
  el.seedBox.classList.toggle('hidden', PRODUCTS.length > 0);

  const q = (el.prodSearch.value || '').trim().toLowerCase();
  const list = q
    ? PRODUCTS.filter((p) => (`${p.name || ''} ${p.id || ''} ${p.desc || ''}`).toLowerCase().includes(q))
    : PRODUCTS;

  el.tableWrap.classList.toggle('hidden', list.length === 0);
  el.prodEmpty.classList.toggle('hidden', !(PRODUCTS.length > 0 && list.length === 0));

  el.plist.innerHTML = list.map((p) => {
    const bg = p.img ? `background-image:url('${escapeHtml(p.img)}')` : '';
    const catLabel = p.cat === 'wood' ? 'Lite drewno' : 'Poroże';
    const catClass = p.cat === 'wood' ? 'wood' : 'antler';
    const nPhotos = Array.isArray(p.images) ? p.images.length : (p.img ? 1 : 0);
    return `<tr data-id="${escapeHtml(p.id)}">
      <td><div class="pthumb" style="${bg}"></div></td>
      <td><span class="pname">${escapeHtml(p.name)}</span><code class="pid">${escapeHtml(p.id)}</code></td>
      <td class="hide-sm"><span class="badge ${catClass}">${catLabel}</span></td>
      <td class="price-cell">${fmtPrice(p.price)}</td>
      <td class="hide-sm">${nPhotos} zdj.</td>
      <td class="col-actions">
        <button class="btn secondary small" data-act="edit">Edytuj</button>
        <button class="btn danger small" data-act="del">Usuń</button>
      </td>
    </tr>`;
  }).join('');

  el.plist.querySelectorAll('tr').forEach((row) => {
    const id = row.getAttribute('data-id');
    row.querySelector('[data-act="edit"]').addEventListener('click', () => startEdit(id));
    row.querySelector('[data-act="del"]').addEventListener('click', () => remove(id));
  });
}
el.prodSearch.addEventListener('input', renderList);

/* ---------- modal: otwieranie / zamykanie ---------- */
function openModal() {
  el.productModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setTimeout(() => f.name.focus(), 50);
}
function closeModal() {
  el.productModal.classList.add('hidden');
  document.body.style.overflow = '';
}
el.modalClose.addEventListener('click', closeModal);
el.cancelEdit.addEventListener('click', closeModal);
el.productModal.addEventListener('mousedown', (e) => {
  if (e.target === el.productModal) closeModal(); // klik w tło zamyka
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !el.productModal.classList.contains('hidden')) closeModal();
});
el.addProductBtn.addEventListener('click', () => {
  clearForm();
  el.formTitle.textContent = 'Dodaj produkt';
  el.saveBtn.textContent = 'Zapisz produkt';
  openModal();
});

/* ---------- formularz: dodawanie / edycja ---------- */
function fillForm(p) {
  f.name.value = p.name || '';
  f.cat.value = p.cat || 'wood';
  f.price.value = p.price != null ? p.price : '';
  f.desc.value = p.desc || '';
  f.descFull.value = p.descFull || '';
  f.art.value = p.art || 'w1';
  f.id.value = p.id || '';

  gallery = [];
  originalIds = [];
  const photos = Array.isArray(p.photos) ? p.photos : [];
  if (photos.length) {
    for (const ph of photos) {
      gallery.push({ key: nextKey(), id: ph.id || null, url: ph.url, dataUrl: null });
      if (ph.id) originalIds.push(ph.id);
    }
  } else if (p.img) {
    gallery.push({ key: nextKey(), id: null, url: p.img, dataUrl: null });
  }
  gal.urlInput.value = '';
  renderGallery();
}
function clearForm() {
  el.editingId.value = '';
  el.productForm.reset();
  f.art.value = 'w1';
  f.id.removeAttribute('readonly');
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
  clearForm();
  el.editingId.value = id;
  fillForm(p);
  f.id.setAttribute('readonly', 'readonly'); // id nie zmieniamy przy edycji
  el.formTitle.textContent = 'Edytuj produkt';
  el.saveBtn.textContent = 'Zapisz zmiany';
  openModal();
}

// Uzgodnij galerię na serwerze z bieżącym stanem edytora.
async function syncGallery(productId) {
  const currentIds = gallery.filter((x) => x.id).map((x) => x.id);
  const toDelete = originalIds.filter((id) => !currentIds.includes(id));
  for (const id of toDelete) {
    await api('/api/photos/' + encodeURIComponent(id), { method: 'DELETE' });
  }
  for (const item of gallery) {
    if (item.id) continue;
    const img = item.dataUrl || item.url;
    const r = await api('/api/photos', { method: 'POST', body: JSON.stringify({ productId, img }) });
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
    closeModal();
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
    if (el.editingId.value === id) { closeModal(); clearForm(); }
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
async function loadOrders() {
  try {
    const orders = await api('/api/orders');
    ORDERS = Array.isArray(orders) ? orders : [];
  } catch (err) {
    ORDERS = [];
    el.ordersBox.innerHTML = `<p class="hint">Nie udało się pobrać zamówień: ${escapeHtml(err.message)}</p>`;
    if (el.dashOrders) el.dashOrders.innerHTML = `<p class="hint">Nie udało się pobrać zamówień.</p>`;
  }
  renderOrders();
  renderDashOrders();
  renderStats();
}

function orderRowHtml(o) {
  const items = (Array.isArray(o.items) ? o.items : [])
    .map((it) => `${escapeHtml(it.name)} × ${it.qty}`).join(', ');
  const ship = o.shipping && o.shipping.address ? o.shipping.address : null;
  const shipLine = ship
    ? [ship.line1, ship.line2, `${ship.postal_code || ''} ${ship.city || ''}`.trim(), ship.country]
      .filter(Boolean).map(escapeHtml).join(', ')
    : '';
  const st = String(o.status || '').toLowerCase();
  const stClass = st === 'paid' ? 'paid' : (st === 'pending' ? 'pending' : 'other');
  const stLabel = st === 'paid' ? 'Opłacone' : (st === 'pending' ? 'W trakcie' : escapeHtml(o.status || '—'));
  return `<div class="order-row">
    <div class="order-top">
      <span class="order-amount">${fmtGrosze(o.amount_total, o.currency)}</span>
      <span class="status ${stClass}">${stLabel}</span>
      <span class="hint" style="margin-left:auto">${fmtDate(o.created_at)}</span>
    </div>
    <div class="hint" style="margin-top:6px">${escapeHtml(o.customer_name || '')}${o.email ? ' · ' + escapeHtml(o.email) : ''}</div>
    ${items ? `<div class="order-items">${escapeHtml(items)}</div>` : ''}
    ${shipLine ? `<div class="hint" style="margin-top:6px">Wysyłka: ${shipLine}</div>` : ''}
    <div class="hint" style="margin-top:6px;opacity:.6;font-size:.82em"><code>${escapeHtml(o.id)}</code></div>
  </div>`;
}

function renderOrders() {
  if (el.navOrders) el.navOrders.textContent = String(ORDERS.length);
  const q = (el.orderSearch.value || '').trim().toLowerCase();
  const list = q
    ? ORDERS.filter((o) => {
        const items = (Array.isArray(o.items) ? o.items : []).map((it) => it.name).join(' ');
        return (`${o.customer_name || ''} ${o.email || ''} ${o.id || ''} ${o.status || ''} ${items}`)
          .toLowerCase().includes(q);
      })
    : ORDERS;
  if (!ORDERS.length) {
    el.ordersBox.innerHTML = '<div class="empty">Brak zamówień. Pojawią się tu po pierwszej udanej płatności.</div>';
    return;
  }
  if (!list.length) {
    el.ordersBox.innerHTML = '<div class="empty">Brak zamówień pasujących do wyszukiwania.</div>';
    return;
  }
  el.ordersBox.innerHTML = list.map(orderRowHtml).join('');
}
el.orderSearch.addEventListener('input', renderOrders);

function renderDashOrders() {
  if (!el.dashOrders) return;
  if (!ORDERS.length) {
    el.dashOrders.innerHTML = '<p class="hint">Brak zamówień.</p>';
    return;
  }
  el.dashOrders.innerHTML = ORDERS.slice(0, 5).map(orderRowHtml).join('');
}

/* ---------- statystyki (pulpit) ---------- */
function renderStats() {
  if (el.statProducts) el.statProducts.textContent = String(PRODUCTS.length);
  if (el.statOrders) el.statOrders.textContent = String(ORDERS.length);
  const paid = ORDERS.filter((o) => String(o.status || '').toLowerCase() === 'paid');
  const revenue = paid.reduce((sum, o) => sum + (Number(o.amount_total) || 0), 0);
  const base = paid.length ? paid : ORDERS;
  const baseRevenue = base.reduce((sum, o) => sum + (Number(o.amount_total) || 0), 0);
  if (el.statRevenue) el.statRevenue.textContent = fmtGrosze(revenue, 'pln');
  if (el.statAvg) el.statAvg.textContent = base.length ? fmtGrosze(Math.round(baseRevenue / base.length), 'pln') : '—';
}

if (el.ordersReload) el.ordersReload.addEventListener('click', loadOrders);
if (el.dashReload) el.dashReload.addEventListener('click', async () => { await loadProducts(); await loadOrders(); });

/* start */
renderGallery();
checkSession();
