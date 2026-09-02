/* ---------- Antlerwood shared site script ---------- */

/* products data
   - "img": przykładowe zdjęcie (Unsplash, darmowe do użytku komercyjnego).
            Podmień na własne foto: wrzuć plik do assets/ i wpisz np. img:"assets/moje-zdjecie.jpg".
   - "art": zapasowe tło CSS w kolorach marki — pokaże się automatycznie, gdyby zdjęcie się nie załadowało.
*/
/* PRODUCTS = dane produktów.
   Poniższa lista to DANE STARTOWE / FALLBACK — używane, gdy backend (API) nie odpowiada
   (np. strona otwarta lokalnie z pliku). Na Vercelu z podpiętą bazą produkty są pobierane
   z /api/products (patrz loadProductsFromApi na końcu pliku) i ta lista jest podmieniana. */
let PRODUCTS = [
  {id:"polka-dab",name:"Półka z litego dębu",cat:"wood",art:"w1",tag:"Lite drewno",price:590,desc:"Masywna półka ścienna z naturalnym rysunkiem słojów, olejowana ręcznie.",img:"https://images.unsplash.com/photo-1594026112284-02bb6f3352fe?w=800&q=80&auto=format&fit=crop"},
  {id:"stol-plaster",name:"Stół z plastra drewna",cat:"wood",art:"w2",tag:"Lite drewno",price:2400,desc:"Blat z pojedynczego plastra pnia, surowa krawędź, stalowe nogi.",img:"https://images.unsplash.com/photo-1533090161767-e6ffed986c88?w=800&q=80&auto=format&fit=crop"},
  {id:"wieszak-deska",name:"Wieszak deska i poroże",cat:"antler",art:"a1",tag:"Poroże",price:340,desc:"Deska z litego drewna z autentycznym porożem jako haki. Jeden egzemplarz.",img:"https://images.unsplash.com/photo-1509660933844-6910e12765a0?w=800&q=80&auto=format&fit=crop"},
  {id:"komoda",name:"Komoda rustykalna",cat:"wood",art:"w3",tag:"Lite drewno",price:3200,desc:"Komoda z litego drewna z akcentem poroża przy uchwytach.",img:"https://images.unsplash.com/photo-1595428774223-ef52624120d2?w=800&q=80&auto=format&fit=crop"},
  {id:"stojak-noze",name:"Stojak na noże z poroża",cat:"antler",art:"a2",tag:"Poroże",price:420,desc:"Specjalistyczny ekspozytor kolekcjonerski na noże z naturalnego poroża.",img:"https://images.unsplash.com/photo-1593618998160-e34014e67546?w=800&q=80&auto=format&fit=crop"},
  {id:"organizer",name:"Organizer na biżuterię",cat:"antler",art:"a3",tag:"Poroże",price:210,desc:"Stojak na pierścionki i klucze z rozgałęzień poroża na drewnianej bazie.",img:"https://images.unsplash.com/photo-1602173574767-37ac01994b2a?w=800&q=80&auto=format&fit=crop"},
  {id:"wieszak-galaz",name:"Wieszak z gałęzi",cat:"wood",art:"w1",tag:"Lite drewno",price:260,desc:"Wieszak z przepołowionej naturalnej gałęzi, surowy, organiczny kształt.",img:"https://images.unsplash.com/photo-1567016432779-094069958ea5?w=800&q=80&auto=format&fit=crop"},
  {id:"ekspozytor-miecze",name:"Ekspozytor na miecze",cat:"antler",art:"centerpc",tag:"Poroże",price:680,desc:"Unikalny wieszak na miecze z poroża, mocny akcent w rustykalnym wnętrzu.",img:"https://images.unsplash.com/photo-1520697830682-bbb6e85e2b0b?w=800&q=80&auto=format&fit=crop"},
  {id:"stolek-poroze",name:"Stołek z poroża",cat:"antler",art:"a2",tag:"Poroże",price:1150,desc:"Stołek wykonany w całości z użyciem poroża, rzeźbiarska forma użytkowa.",img:"https://images.unsplash.com/photo-1503602642458-232111445657?w=800&q=80&auto=format&fit=crop"},
];

/* format ceny w PLN */
function fmtPrice(v){ return v.toLocaleString('pl-PL') + ' zł'; }

/* ================= I18N (PL / EN / DE) ================= */
const LANG_KEY = 'antlerwood_lang';
const SUPPORTED_LANGS = ['pl','en','de'];
const DEFAULT_LANG = 'en';   // język główny (domyślny) przy pierwszym wejściu
let LANG = loadLang();

function loadLang(){
  try{
    const saved = localStorage.getItem(LANG_KEY);
    if(saved && SUPPORTED_LANGS.includes(saved)) return saved;
  }catch(e){}
  // wykryj z przeglądarki; jeśli nieobsługiwany, użyj głównego (DEFAULT_LANG)
  const nav = (navigator.language||DEFAULT_LANG).slice(0,2).toLowerCase();
  return SUPPORTED_LANGS.includes(nav) ? nav : DEFAULT_LANG;
}
function saveLang(){ try{ localStorage.setItem(LANG_KEY, LANG); }catch(e){} }

/* tłumaczenie po kluczu */
function tr(key){
  const dict = (window.I18N && window.I18N[LANG]) || {};
  return (key in dict) ? dict[key] : (window.I18N && window.I18N.pl && window.I18N.pl[key]) || key;
}
/* tłumaczenie z fallbackiem: jeśli klucz nie istnieje w słowniku (np. produkt dodany
   w panelu admina, który nie ma tłumaczeń), użyj wartości z danych produktu. */
function trOr(key, fallback){
  const cur = (window.I18N && window.I18N[LANG]) || {};
  if(key in cur) return cur[key];
  const pl = (window.I18N && window.I18N.pl) || {};
  if(key in pl) return pl[key];
  return fallback;
}
/* nazwa/opis produktu w bieżącym języku (fallback do danych z bazy/PRODUCTS) */
function pName(p){ return trOr('p.'+p.id+'.name', p.name); }
function pDesc(p){ return trOr('p.'+p.id+'.desc', p.desc); }          // opis główny (krótki)
function pDescFull(p){ return trOr('p.'+p.id+'.descFull', p.descFull || p.desc); } // opis produktu (pełny; fallback na główny)
function pTag(p){ return p.cat==='wood' ? tr('filter.wood') : tr('filter.antler'); }

/* podmień wszystkie elementy z data-i18n / data-i18n-ph */
function applyTranslations(){
  document.querySelectorAll('[data-i18n]').forEach(el=>{
    const k = el.getAttribute('data-i18n');
    const val = tr(k);
    if(val) el.textContent = val;
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el=>{
    const k = el.getAttribute('data-i18n-ph');
    const val = tr(k);
    if(val) el.setAttribute('placeholder', val);
  });
  // atrybut lang na <html>
  document.documentElement.setAttribute('lang', LANG);
  // etykieta przełącznika
  const label = document.getElementById('langLabel');
  if(label) label.textContent = LANG.toUpperCase();
  // ceny z data-price (PDP, related) sformatuj wg języka (waluta zł niezmienna)
  document.querySelectorAll('[data-price]').forEach(el=>{
    const v = parseFloat(el.getAttribute('data-price'));
    if(!isNaN(v)) el.textContent = fmtPrice(v);
  });
}

/* ustaw język i odśwież wszystko */
function setLang(lang){
  if(!SUPPORTED_LANGS.includes(lang)) return;
  LANG = lang; saveLang();
  applyTranslations();
  // przerenderuj dynamiczne fragmenty
  if(document.getElementById('grid')) renderProducts();
  updateCartUI();
}

function initLangSwitch(){
  const sw = document.getElementById('langSwitch');
  if(!sw) return;
  const btn = document.getElementById('langBtn');
  const menu = document.getElementById('langMenu');
  btn?.addEventListener('click',e=>{
    e.stopPropagation();
    const open = sw.classList.toggle('open');
    btn.setAttribute('aria-expanded', open ? 'true':'false');
  });
  menu?.querySelectorAll('[data-lang]').forEach(b=>{
    b.addEventListener('click',()=>{
      setLang(b.dataset.lang);
      sw.classList.remove('open');
      btn?.setAttribute('aria-expanded','false');
    });
  });
  document.addEventListener('click',e=>{
    if(!sw.contains(e.target)){ sw.classList.remove('open'); btn?.setAttribute('aria-expanded','false'); }
  });
}


/* render products into #grid, optional filter: "all" | "wood" | "antler" */
function renderProducts(filter){
  const grid = document.getElementById('grid');
  if(!grid) return;
  filter = filter || grid.getAttribute('data-filter') || 'all';
  grid.innerHTML = PRODUCTS.map(p=>{
    if(filter!=="all" && p.cat!==filter) return "";
    // Zdjęcie z fallbackiem: jeśli obraz się nie załaduje, pokazujemy tło CSS w kolorach marki.
    const visual = p.img
      ? `<div class="art ${p.art}"></div><img src="${p.img}" alt="${pName(p)}" loading="lazy" onerror="this.style.display='none'">`
      : `<div class="art ${p.art}"></div>`;
    return `<article class="card" data-cat="${p.cat}" data-id="${p.id}" onclick="location.href='produkt.html?id=${encodeURIComponent(p.id)}'">
      <div class="img">${visual}<span class="tag">${pTag(p)}</span></div>
      <div class="info">
        <h4>${pName(p)}</h4>
        <p class="desc">${pDesc(p)}</p>
        <div class="foot">
          <span class="price">${fmtPrice(p.price)}</span>
          <button class="add" type="button" data-id="${p.id}" onclick="event.stopPropagation()">${tr('card.add')}</button>
        </div>
      </div>
    </article>`;
  }).join('');
  grid.classList.add('stagger');
  grid.classList.remove('in');           // reset, aby re-animować po zmianie filtra
  bindAdd();
  requestAnimationFrame(()=>{requestAnimationFrame(revealScan);});
}

function bindAdd(){
  document.querySelectorAll('.add').forEach(b=>{
    b.addEventListener('click',e=>{
      e.stopPropagation();
      addToCart(b.dataset.id);
    });
  });
}

/* ---------------- KOSZYK ---------------- */
/* Koszyk zapisywany w przeglądarce (localStorage), więc działa między podstronami.
   Aby zamówienia realnie działały, podłącz płatności lub Shopify (patrz README). */
const CART_KEY = 'antlerwood_cart';
let CART = loadCart();

function loadCart(){
  try{ return JSON.parse(localStorage.getItem(CART_KEY)) || []; }
  catch(e){ return []; }
}
function saveCart(){
  try{ localStorage.setItem(CART_KEY, JSON.stringify(CART)); }catch(e){}
}

function cartCount(){ return CART.reduce((s,i)=>s+i.qty,0); }
function cartTotal(){ return CART.reduce((s,i)=>{const p=PRODUCTS.find(x=>x.id===i.id);return s+(p?p.price*i.qty:0);},0); }

function addToCart(id,qty){
  qty = qty || 1;
  const item=CART.find(i=>i.id===id);
  if(item) item.qty+=qty; else CART.push({id,qty});
  saveCart();
  updateCartUI();
  showToast(tr('cart.added'));
  bumpCartBadge();
}
function removeFromCart(id){
  CART=CART.filter(i=>i.id!==id);
  saveCart();
  updateCartUI();
}
function changeQty(id,delta){
  const item=CART.find(i=>i.id===id);
  if(!item) return;
  item.qty+=delta;
  if(item.qty<=0) CART=CART.filter(i=>i.id!==id);
  saveCart();
  updateCartUI();
}

function updateCartUI(){
  // licznik w navbarze
  const badge=document.getElementById('cartBadge');
  const n=cartCount();
  if(badge){ badge.textContent=n; badge.classList.toggle('show',n>0); }

  // --- szuflada (drawer) ---
  const body=document.getElementById('cartBody');
  const foot=document.getElementById('cartFoot');
  if(body){
    if(CART.length===0){
      body.innerHTML=`<div class="cart-empty"><p>${tr('cart.empty')}</p><a href="sklep.html" class="btn btn-ghost">${tr('cart.goShop')}</a></div>`;
      if(foot) foot.style.display='none';
    }else{
      body.innerHTML=CART.map(i=>cartItemHTML(i,'drawer')).join('');
      if(foot){ foot.style.display='block'; document.getElementById('cartTotal').textContent=fmtPrice(cartTotal()); }
      wireCartButtons(body);
    }
  }

  // --- pełna strona koszyka ---
  const pageItems=document.getElementById('cartPageItems');
  if(pageItems){
    const summary=document.getElementById('cartSummary');
    if(CART.length===0){
      pageItems.innerHTML=`<div class="cart-empty-page"><p>${tr('cart.empty')}</p><a href="sklep.html" class="btn btn-primary">${tr('cart.goShop')}</a></div>`;
      if(summary) summary.style.display='none';
    }else{
      pageItems.innerHTML=CART.map(i=>cartItemHTML(i,'page')).join('');
      if(summary) summary.style.display='';
      const st=document.getElementById('csSubtotal'); if(st) st.textContent=fmtPrice(cartTotal());
      const tt=document.getElementById('csTotal'); if(tt) tt.textContent=fmtPrice(cartTotal());
      wireCartButtons(pageItems);
    }
  }
}

function cartItemHTML(i,variant){
  const p=PRODUCTS.find(x=>x.id===i.id); if(!p) return '';
  const visual = p.img
    ? `<div class="art ${p.art}"></div><img src="${p.img}" alt="${pName(p)}" onerror="this.style.display='none'">`
    : `<div class="art ${p.art}"></div>`;
  const lineTotal = fmtPrice(p.price*i.qty);
  if(variant==='page'){
    return `<div class="cartp-item" data-id="${p.id}">
      <a class="cartp-img" href="produkt-${p.id}.html">${visual}</a>
      <div class="cartp-main">
        <a href="produkt-${p.id}.html" class="cartp-name">${pName(p)}</a>
        <span class="cartp-tag">${pTag(p)}</span>
        <button type="button" class="ci-remove" data-id="${p.id}">${tr('cart.remove')}</button>
      </div>
      <div class="cartp-qty">
        <button type="button" class="qty-btn" data-act="dec" data-id="${p.id}">–</button>
        <span>${i.qty}</span>
        <button type="button" class="qty-btn" data-act="inc" data-id="${p.id}">+</button>
      </div>
      <div class="cartp-price">${lineTotal}</div>
    </div>`;
  }
  return `<div class="cart-item" data-id="${p.id}">
    <div class="ci-img">${visual}</div>
    <div class="ci-info">
      <h5>${pName(p)}</h5>
      <span class="ci-price">${fmtPrice(p.price)}</span>
      <div class="ci-qty">
        <button type="button" class="qty-btn" data-act="dec" data-id="${p.id}" aria-label="Mniej">–</button>
        <span>${i.qty}</span>
        <button type="button" class="qty-btn" data-act="inc" data-id="${p.id}" aria-label="Więcej">+</button>
        <button type="button" class="ci-remove" data-id="${p.id}" aria-label="${tr('cart.remove')}">${tr('cart.remove')}</button>
      </div>
    </div>
  </div>`;
}

function wireCartButtons(scope){
  scope.querySelectorAll('.qty-btn').forEach(b=>b.addEventListener('click',()=>{
    changeQty(b.dataset.id, b.dataset.act==='inc'?1:-1);
  }));
  scope.querySelectorAll('.ci-remove').forEach(b=>b.addEventListener('click',()=>removeFromCart(b.dataset.id)));
}

function openCart(){ document.getElementById('cartDrawer')?.classList.add('open');
  document.getElementById('cartOverlay')?.classList.add('open'); document.body.style.overflow='hidden'; }
function closeCart(){ document.getElementById('cartDrawer')?.classList.remove('open');
  document.getElementById('cartOverlay')?.classList.remove('open'); document.body.style.overflow=''; }

function bumpCartBadge(){
  const badge=document.getElementById('cartBadge');
  if(!badge) return;
  badge.classList.remove('pop'); void badge.offsetWidth; badge.classList.add('pop');
}

function initCart(){
  const btn=document.getElementById('cartBtn');
  if(btn) btn.addEventListener('click',e=>{e.preventDefault();openCart();});
  document.getElementById('cartClose')?.addEventListener('click',closeCart);
  document.getElementById('cartOverlay')?.addEventListener('click',closeCart);
  document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeCart(); });

  // drawer "Przejdź do kasy" -> pełna strona koszyka
  document.getElementById('cartCheckout')?.addEventListener('click',()=>{
    window.location.href='koszyk.html';
  });
  // pełna strona koszyka -> kasa (demo)
  document.getElementById('csCheckout')?.addEventListener('click',()=>{
    if(CART.length===0) return;
    showToast(tr('cart.demo'));
  });

  // strona produktu (PDP): stepper + dodaj do koszyka
  const pdpAdd=document.getElementById('pdpAdd');
  if(pdpAdd){
    const qtyEl=document.getElementById('pdpQty');
    let q=1;
    document.getElementById('pdpInc')?.addEventListener('click',()=>{q++;qtyEl.textContent=q;});
    document.getElementById('pdpDec')?.addEventListener('click',()=>{if(q>1){q--;qtyEl.textContent=q;}});
    pdpAdd.addEventListener('click',()=>{ addToCart(pdpAdd.dataset.id,q); openCart(); });
  }

  updateCartUI();
}

/* filter chips */
function initFilters(){
  document.querySelectorAll('.chip').forEach(c=>{
    c.addEventListener('click',()=>{
      document.querySelectorAll('.chip').forEach(x=>x.classList.remove('active'));
      c.classList.add('active');
      renderProducts(c.dataset.filter);
    });
  });
}

/* toast */
let toastTimer;
function showToast(msg){
  const t=document.getElementById('toast');
  if(!t) return;
  if(msg) t.querySelector('span').textContent=msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>t.classList.remove('show'),2400);
}

/* mobile menu */
function initMenu(){
  const burger=document.getElementById('burger');
  const menu=document.getElementById('menu');
  if(!burger||!menu) return;
  burger.addEventListener('click',()=>menu.classList.toggle('open'));
  menu.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>menu.classList.remove('open')));
}

/* scroll reveal */
function revealScan(){
  document.querySelectorAll('.reveal, .stagger').forEach(el=>{
    const r=el.getBoundingClientRect();
    if(r.top < window.innerHeight-60) el.classList.add('in');
  });
}

/* navbar: przezroczysty na górze, tło przy scrollu */
function initNavScroll(){
  const nav=document.querySelector('header.nav');
  if(!nav) return;
  function upd(){ nav.classList.toggle('scrolled', window.scrollY>40); }
  upd();
  window.addEventListener('scroll',upd,{passive:true});
}

/* generuj unoszące się drobinki (pyłek/kurz) w hero */
function initDust(){
  const box=document.querySelector('.hero-dust');
  if(!box) return;
  const N=18;
  let html='';
  for(let i=0;i<N;i++){
    const left=Math.random()*100;
    const dur=9+Math.random()*12;
    const delay=Math.random()*12;
    const size=2+Math.random()*2.5;
    const drift=(Math.random()*60-30).toFixed(0);
    html+=`<i style="left:${left}%;width:${size}px;height:${size}px;`+
          `animation-duration:${dur}s;animation-delay:-${delay}s;`+
          `--drift:${drift}px"></i>`;
  }
  box.innerHTML=html;
}

/* hero parallax — bezpieczny, nie odsłania krawędzi tła.
   Tło ma zapas (110% wysokości, wyśrodkowane), więc lekki ruch mieści się w kadrze. */
function initParallax(){
  const hero=document.querySelector('.hero');
  if(!hero) return;
  const bg=hero.querySelector('.hero-bg');
  const content=hero.querySelector('.hero-content');
  if(!bg) return;
  let ticking=false;
  function update(){
    const y=window.scrollY;
    if(y<window.innerHeight*1.2){
      // tło przesuwa się wolniej niż strona (efekt głębi), w bezpiecznym zakresie
      bg.style.transform=`translateY(${y*0.18}px) scale(1.12)`;
      if(content) content.style.transform=`translateY(${y*0.06}px)`;
      // delikatne przygaszanie treści przy scrollu
      if(content) content.style.opacity=String(Math.max(0,1-y/(window.innerHeight*0.85)));
    }
    ticking=false;
  }
  window.addEventListener('scroll',()=>{
    if(!ticking){requestAnimationFrame(update);ticking=true;}
  },{passive:true});
}

/* contact form (demo — no backend) */
function initForm(){
  const form=document.getElementById('contactForm');
  if(!form) return;
  form.addEventListener('submit',e=>{
    e.preventDefault();
    showToast();
    form.reset();
    const t=document.getElementById('toast');
    if(t) t.querySelector('span').textContent=tr('cont.sent');
  });
}

/* On load, sync the active chip to match the grid's data-filter
   (so "Meble z drewna" opens with "Lite drewno" selected, etc.) */
function syncActiveChip(){
  const grid=document.getElementById('grid');
  if(!grid) return;
  const f=grid.getAttribute('data-filter')||'all';
  document.querySelectorAll('.chip').forEach(c=>{
    c.classList.toggle('active', c.dataset.filter===f);
  });
}

/* ---------------- POBIERANIE PRODUKTÓW Z BACKENDU ---------------- */
/* Pobiera produkty z /api/products (Vercel Functions + Postgres).
   Jeśli API nie odpowiada (np. brak backendu / plik lokalny), zostaje lista fallback. */
async function loadProductsFromApi(){
  try{
    const res = await fetch('/api/products', { headers:{ 'Accept':'application/json' } });
    if(!res.ok) return false;
    const data = await res.json();
    if(Array.isArray(data) && data.length){
      PRODUCTS = data;
      return true;
    }
  }catch(e){ /* offline / brak API — używamy fallbacku */ }
  return false;
}

/* ---------------- DYNAMICZNA STRONA PRODUKTU (produkt.html?id=...) ---------------- */
function renderPdp(){
  const root = document.getElementById('pdpRoot');
  if(!root) return;
  const id = new URLSearchParams(location.search).get('id');
  const p = PRODUCTS.find(x=>x.id===id);

  if(!p){
    root.innerHTML = `<div class="wrap" style="padding:120px 0;text-align:center">
      <h1>${tr('pdp.notfound')||'Nie znaleziono produktu'}</h1>
      <p><a class="pdp-back" href="sklep.html">${tr('pdp.back')||'← Wróć do sklepu'}</a></p></div>`;
    return;
  }

  const collectionHref = p.cat==='wood' ? 'lite-drewno.html' : 'poroze.html';
  const collectionKey  = p.cat==='wood' ? 'nav.wood' : 'nav.antler';
  const catKey         = p.cat==='wood' ? 'filter.wood' : 'filter.antler';
  // galeria: lista zdjęć (pierwsze = główne). Zgodność wstecz z pojedynczym p.img.
  const imgs = (Array.isArray(p.images) && p.images.length) ? p.images : (p.img ? [p.img] : []);
  const mainSrc = imgs[0] || '';
  const visual = mainSrc
    ? `<div class="art ${p.art}"></div><img id="pdpMainImg" src="${mainSrc}" alt="${pName(p)}" onerror="this.style.display='none'">`
    : `<div class="art ${p.art}"></div>`;
  const thumbsHtml = imgs.length > 1
    ? `<div class="pdp-thumbs">${imgs.map((src,i)=>
        `<button type="button" class="pdp-thumb${i===0?' active':''}" data-src="${src}" aria-label="Zdjęcie ${i+1}">
           <img src="${src}" alt="" loading="lazy" onerror="this.style.display='none'"></button>`).join('')}</div>`
    : '';

  // produkty powiązane: inne z tej samej kategorii (maks. 3)
  const related = PRODUCTS.filter(x=>x.cat===p.cat && x.id!==p.id).slice(0,3);
  const relHtml = related.map(r=>{
    const rv = r.img
      ? `<div class="art ${r.art}"></div><img src="${r.img}" alt="${pName(r)}" loading="lazy" onerror="this.style.display='none'">`
      : `<div class="art ${r.art}"></div>`;
    return `<a href="produkt.html?id=${encodeURIComponent(r.id)}" class="rel-card">
      <div class="rel-img">${rv}</div>
      <div class="rel-info"><h4>${pName(r)}</h4><span class="price">${fmtPrice(r.price)}</span></div>
    </a>`;
  }).join('');

  document.title = `${pName(p)} | ANTLERWOOD`;

  root.innerHTML = `<div class="wrap">
    <nav class="crumbs"><a href="index.html">${tr('pdp.start')||'Start'}</a> <span>/</span>
      <a href="${collectionHref}">${tr(collectionKey)}</a> <span>/</span> <em>${pName(p)}</em></nav>
    <div class="pdp-grid">
      <div class="pdp-gallery reveal">
        <div class="pdp-main">${visual}<span class="tag">${tr(catKey)}</span></div>
        ${thumbsHtml}
      </div>
      <div class="pdp-info reveal">
        <div class="kick">${tr(catKey)}</div>
        <h1>${pName(p)}</h1>
        <div class="pdp-price">${fmtPrice(p.price)}</div>
        <p class="pdp-desc">${pDescFull(p)}</p>
        <div class="pdp-actions">
          <div class="qty-stepper">
            <button type="button" class="qty-btn" id="pdpDec" aria-label="Mniej">–</button>
            <span id="pdpQty">1</span>
            <button type="button" class="qty-btn" id="pdpInc" aria-label="Więcej">+</button>
          </div>
          <button class="btn btn-primary pdp-add" type="button" data-id="${p.id}" id="pdpAdd">${tr('pdp.add')||'Do koszyka'}</button>
        </div>
        <a href="${collectionHref}" class="pdp-back">${tr('pdp.back')||'← Wróć do kolekcji'}</a>
      </div>
    </div>
    ${related.length ? `<div class="pdp-related">
      <div class="sec-head reveal"><div class="kick">${tr('pdp.relKick')||'Zobacz też'}</div>
        <h2>${tr('pdp.relTitle')||'Podobne'}</h2></div>
      <div class="rel-grid stagger">${relHtml}</div>
    </div>` : ''}
  </div>`;

  // obsługa ilości + dodania do koszyka
  let qty = 1;
  const qtyEl = document.getElementById('pdpQty');
  const dec = document.getElementById('pdpDec');
  const inc = document.getElementById('pdpInc');
  if(dec) dec.addEventListener('click',()=>{ qty=Math.max(1,qty-1); qtyEl.textContent=qty; });
  if(inc) inc.addEventListener('click',()=>{ qty+=1; qtyEl.textContent=qty; });
  const add = document.getElementById('pdpAdd');
  if(add) add.addEventListener('click',()=>addToCart(p.id, qty));

  // galeria: kliknięcie miniaturki podmienia zdjęcie główne
  const mainImg = document.getElementById('pdpMainImg');
  root.querySelectorAll('.pdp-thumb').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const src = btn.getAttribute('data-src');
      if(mainImg){ mainImg.src = src; mainImg.style.display=''; }
      root.querySelectorAll('.pdp-thumb').forEach(b=>b.classList.toggle('active', b===btn));
    });
  });

  requestAnimationFrame(()=>{requestAnimationFrame(revealScan);});
}

/* init on every page */
window.addEventListener('DOMContentLoaded',async ()=>{
  applyTranslations();     // najpierw język (statyczne teksty)
  initLangSwitch();
  syncActiveChip();
  renderProducts();        // od razu render z danych fallback (szybki paint)
  initFilters();
  initMenu();
  initParallax();
  initNavScroll();
  initDust();
  initCart();
  initForm();
  revealScan();

  // następnie pobierz aktualne produkty z bazy i przerenderuj, jeśli się udało
  const ok = await loadProductsFromApi();
  if(ok){
    if(document.getElementById('grid')) renderProducts();
    updateCartUI();
  }
  // dynamiczna strona produktu (produkt.html) — renderuj po pobraniu danych
  renderPdp();
});
window.addEventListener('scroll',revealScan,{passive:true});
window.addEventListener('load',revealScan);
