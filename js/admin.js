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
};

const f = {
  name: $('f-name'), cat: $('f-cat'), price: $('f-price'),
  desc: $('f-desc'), img: $('f-img'), art: $('f-art'), id: $('f-id'),
};

let PRODUCTS = [];

/* ---------- pomocnicze ---------- */
function toast(text, type) {
  el.msg.textContent = text;
  el.msg.className = 'show ' + (type || '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.msg.className = ''; }, 3200);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    ...opts,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* brak treści */ }
  if (!res.ok) throw new Error((data && data.error) || `Błąd ${res.status}`);
  return data;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function fmtPrice(v) { return Number(v || 0).toLocaleString('pl-PL') + ' zł'; }

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
    return `<div class="pitem" data-id="${escapeHtml(p.id)}">
      <div class="pthumb" style="${bg}"></div>
      <div class="pmeta">
        <b>${escapeHtml(p.name)}</b>
        <span class="sub">${fmtPrice(p.price)} · <span class="badge">${catLabel}</span> · <code>${escapeHtml(p.id)}</code></span>
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
  f.img.value = p.img || '';
  f.art.value = p.art || 'w1';
  f.id.value = p.id || '';
}
function clearForm() {
  el.editingId.value = '';
  el.productForm.reset();
  f.art.value = 'w1';
  el.formTitle.textContent = 'Dodaj produkt';
  el.saveBtn.textContent = 'Zapisz produkt';
  el.cancelEdit.classList.add('hidden');
  f.id.removeAttribute('readonly');
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

el.productForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    name: f.name.value.trim(),
    cat: f.cat.value,
    price: Number(f.price.value) || 0,
    desc: f.desc.value.trim(),
    img: f.img.value.trim(),
    art: f.art.value,
    id: f.id.value.trim(),
  };
  if (!payload.name) { toast('Podaj nazwę produktu.', 'err'); return; }

  const editingId = el.editingId.value;
  el.saveBtn.disabled = true;
  try {
    if (editingId) {
      await api('/api/products/' + encodeURIComponent(editingId), {
        method: 'PUT', body: JSON.stringify(payload),
      });
      toast('Zapisano zmiany.', 'ok');
    } else {
      await api('/api/products', { method: 'POST', body: JSON.stringify(payload) });
      toast('Dodano produkt.', 'ok');
    }
    clearForm();
    await loadProducts();
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    el.saveBtn.disabled = false;
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

/* start */
checkSession();
