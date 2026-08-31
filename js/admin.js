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
  file: $('f-file'),
};
const imgUI = {
  preview: $('imgPreview'),
  pickBtn: $('pickBtn'),
  clearBtn: $('clearImgBtn'),
  hint: $('imgHint'),
};

let PRODUCTS = [];

// Stan zdjęcia w formularzu
let pendingImageDataUrl = null; // nowy, wgrany plik (data URL) do wysłania
let existingImg = '';           // obecne zdjęcie edytowanego produktu (do zachowania)
let imageCleared = false;       // czy użytkownik kliknął „Usuń zdjęcie"

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

function showPreview(src) {
  if (src) {
    imgUI.preview.style.backgroundImage = `url('${src.replace(/'/g, "\\'")}')`;
    imgUI.preview.innerHTML = '';
    imgUI.clearBtn.classList.remove('hidden');
  } else {
    imgUI.preview.style.backgroundImage = '';
    imgUI.preview.innerHTML = '<span>Brak zdjęcia</span>';
    imgUI.clearBtn.classList.add('hidden');
  }
}

// Adres zdjęcia wgranego do bazy (żeby nie pokazywać go w polu URL jako „link").
function isInternalImg(v) { return typeof v === 'string' && v.startsWith('/api/img/'); }

imgUI.pickBtn.addEventListener('click', () => f.file.click());

f.file.addEventListener('change', async () => {
  const file = f.file.files && f.file.files[0];
  if (!file) return;
  if (!/^image\//.test(file.type)) { toast('Wybierz plik graficzny (JPG/PNG).', 'err'); return; }
  imgUI.hint.textContent = 'Przetwarzam zdjęcie…';
  imgUI.hint.classList.add('uploading');
  try {
    const dataUrl = await compressImage(file);
    pendingImageDataUrl = dataUrl;
    imageCleared = false;
    f.img.value = ''; // upload ma pierwszeństwo przed URL-em
    showPreview(dataUrl);
    imgUI.hint.textContent = 'Zdjęcie gotowe do zapisu. Kliknij „Zapisz produkt".';
  } catch (err) {
    toast(err.message, 'err');
    imgUI.hint.textContent = 'Nie udało się przetworzyć pliku.';
  } finally {
    imgUI.hint.classList.remove('uploading');
    f.file.value = ''; // pozwól wybrać ten sam plik ponownie
  }
});

imgUI.clearBtn.addEventListener('click', () => {
  pendingImageDataUrl = null;
  existingImg = '';
  imageCleared = true;
  f.img.value = '';
  showPreview(null);
});

// podgląd przy ręcznym wpisaniu URL-a
f.img.addEventListener('input', () => {
  const v = f.img.value.trim();
  if (v) { pendingImageDataUrl = null; imageCleared = false; showPreview(v); }
  else if (!pendingImageDataUrl) showPreview(existingImg || null);
});

// Ustal finalną wartość pola img do wysłania na serwer.
function resolveImgValue() {
  if (pendingImageDataUrl) return pendingImageDataUrl;   // nowy wgrany plik
  if (f.img.value.trim()) return f.img.value.trim();      // podany URL
  if (imageCleared) return '';                            // wyczyszczono
  return existingImg || '';                               // zachowaj obecne (edycja)
}

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
  f.art.value = p.art || 'w1';
  f.id.value = p.id || '';

  // zdjęcie: zachowaj obecne; w polu URL pokaż tylko zewnętrzny link (nie wewnętrzny blob)
  pendingImageDataUrl = null;
  imageCleared = false;
  existingImg = p.img || '';
  f.img.value = (p.img && !isInternalImg(p.img)) ? p.img : '';
  showPreview(p.img || null);
}
function clearForm() {
  el.editingId.value = '';
  el.productForm.reset();
  f.art.value = 'w1';
  el.formTitle.textContent = 'Dodaj produkt';
  el.saveBtn.textContent = 'Zapisz produkt';
  el.cancelEdit.classList.add('hidden');
  f.id.removeAttribute('readonly');
  // reset stanu zdjęcia
  pendingImageDataUrl = null;
  existingImg = '';
  imageCleared = false;
  showPreview(null);
  imgUI.hint.textContent = 'Wybierz plik z dysku (JPG/PNG). Zostanie automatycznie '
    + 'pomniejszony i zapisany w bazie — bez zewnętrznych usług.';
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
    img: resolveImgValue(),
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
