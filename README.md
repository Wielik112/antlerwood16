# ANTLERWOOD — strona firmowa

Statyczna strona (HTML/CSS/JS, bez frameworków i bez build-stepu) **+ lekki backend na Vercelu**
(Serverless Functions + baza Vercel Postgres) i **panel admina** do zarządzania produktami.
Gotowa do wrzucenia na Vercel.

> Backend jest opcjonalny: bez skonfigurowanej bazy strona nadal działa jako statyczna
> (produkty biorą się z listy „fallback" w `js/main.js`). Po podpięciu bazy produkty są
> pobierane z `/api/products`, a Ty dodajesz/edytujesz je w panelu `/admin`.

## Struktura

```
antlerwood-site/
├── index.html          # Strona główna
├── sklep.html          # Sklep — wszystkie produkty (filtr „Wszystko")
├── lite-drewno.html    # Kolekcja: meble z litego drewna (filtr = drewno)
├── poroze.html         # Kolekcja: meble z poroża (filtr = poroże)
├── produkt-<id>.html   # Osobna podstrona każdego produktu (9 sztuk)
├── koszyk.html         # Pełna strona koszyka
├── o-nas.html          # O nas (historia + zespół Adam & Kamil, miejsce na zdjęcie)
├── wysylka.html        # Wysyłka i zwroty
├── pielegnacja.html    # Pielęgnacja drewna
├── regulamin.html      # Regulamin
├── warsztat.html       # O warsztacie / proces
├── kontakt.html        # Kontakt + formularz (demo)
├── css/
│   └── style.css       # Wspólne style wszystkich podstron
├── js/
│   └── main.js         # Produkty, filtry, menu, animacje, formularz
├── assets/
│   └── logo.jpg        # Logo Antlerwood
├── vercel.json         # Konfiguracja (czyste URL-e, cache)
└── README.md
```

## Deploy na Vercel

**Opcja A — przez interfejs (najprościej):**
1. Wejdź na https://vercel.com → "Add New… → Project".
2. Przeciągnij ten folder (albo wgraj repo z GitHuba).
3. Framework Preset: **Other** (to zwykły static site — nie trzeba nic budować).
4. Kliknij **Deploy**. Gotowe.

**Opcja B — przez CLI:**
```bash
npm i -g vercel
cd antlerwood-site
vercel        # podgląd
vercel --prod # produkcja
```

Dzięki `vercel.json` (`cleanUrls: true`) linki działają też bez `.html`, np. `/poroze`.

## Jak edytować

### Dodać / zmienić produkty
Wszystkie produkty są w jednym miejscu: `js/main.js`, tablica `PRODUCTS`.
Każdy produkt to obiekt:
```js
{ id:"polka-dab", name:"Nazwa", cat:"wood", tag:"Lite drewno", price:590, desc:"Opis...", art:"w1", img:"assets/foto.jpg" }
```
- `id`: unikalny identyfikator (używany przez koszyk) — bez spacji, np. `"polka-dab"`.
- `cat`: `"wood"` (drewno) lub `"antler"` (poroże) — decyduje o filtrze/zakładce.
- `price`: liczba w złotych (bez „zł" i spacji), np. `590` — formatowanie robi się samo.
- `art`: nazwa proceduralnego tła-placeholdera (`w1,w2,w3,a1,a2,a3,centerpc`).
- `img`: ścieżka do zdjęcia (opcjonalnie) — patrz „Zdjęcia produktów".

### Logo
Logo w nagłówku i stopce to `assets/logo-mark.png` (Twoje logo z przezroczystym tłem).
Aby je zmienić, podmień ten plik zachowując nazwę.

### Zdjęcie na stronie „O nas"
Strona `o-nas.html` ma miejsce na Wasze wspólne zdjęcie (Adam i Kamil).
Wrzuć plik do `assets/about-team.jpg` — pojawi się automatycznie zamiast placeholdera.
Możesz też podmienić okrągłe awatary (teraz są inicjały) na prawdziwe zdjęcia w kodzie strony.

### Języki (PL / EN / DE)
Przełącznik języka jest w prawym górnym rogu: polski, angielski, niemiecki.
- Wybór zapisuje się w przeglądarce (localStorage) i działa na wszystkich podstronach.
- Język główny (domyślny) to angielski. Przy pierwszej wizycie strona wykrywa język przeglądarki:
  jeśli to polski lub niemiecki, pokazuje ten język; w każdym innym przypadku angielski.
  Zmiana głównego języka: w js/main.js zmień stałą DEFAULT_LANG (np. 'pl', 'en', 'de').
- Wszystkie tłumaczenia są w `js/i18n.js` (obiekt `window.I18N`, klucz `{pl, en, de}`).
  Aby poprawić tekst, znajdź jego klucz i zmień wartość dla danego języka.
- W HTML tekst do tłumaczenia ma atrybut `data-i18n="klucz"` (placeholdery: `data-i18n-ph`).
- Ceny są w zł we wszystkich językach (do zmiany w `js/i18n.js`, sekcja `I18N_CURRENCY`).

### Koszyk (sklep)
Sklep ma działający koszyk: dodawanie produktów, zmiana ilości, usuwanie i podsumowanie kwoty.
Koszyk działa w pamięci przeglądarki (localStorage), więc jest wspólny między podstronami.

## Płatności (Stripe) — prawdziwe zakupy

Sklep ma **wbudowaną, prawdziwą płatność przez Stripe** (jak w aplikacjach SaaS).
Klient klika **„Przejdź do kasy"** na stronie koszyka → jest przekierowany na
bezpieczną, hostowaną stronę płatności Stripe (karta, Apple/Google Pay, BLIK itd.,
w zależności od tego, co włączysz w panelu Stripe) → po opłaceniu wraca na stronę
`dziekujemy.html`, a zamówienie pojawia się w panelu admina.

**Jak to działa (dla bezpieczeństwa):** przeglądarka wysyła do backendu tylko
`id` produktu i ilość. **Ceny wyliczane są po stronie serwera z bazy danych** —
nie da się zapłacić mniej przez podmianę danych w kliencie.

Pliki backendu płatności:
- `api/checkout.js` — tworzy sesję Stripe Checkout (POST z koszykiem → zwraca `url`).
- `api/webhook.js` — odbiera zdarzenia Stripe i zapisuje opłacone zamówienie do bazy.
- `api/order.js` — potwierdza płatność po powrocie na stronę „dziękujemy" (druga,
  niezależna droga zapisu zamówienia — działa nawet, gdyby webhook nie doszedł).
- `api/orders.js` — lista zamówień w panelu admina (tylko po zalogowaniu).

**Wysyłka:** w `api/checkout.js` (stała `SHIPPING_OPTIONS`) są trzy przykładowe
stawki (Polska / Europa / Świat) oraz lista krajów wysyłki (`SHIP_TO`). Dostosuj
kwoty i kraje do własnego cennika. Stripe zbiera też adres i telefon do wysyłki.

### Klucze Stripe — gdzie je wkleić na Vercelu

Klucze bierzesz z panelu Stripe (**Developers → API keys** oraz **Developers → Webhooks**).
Na start użyj kluczy **testowych** (`sk_test_…`), a po testach przełącz na **Live** (`sk_live_…`).

Na Vercelu: **Project → Settings → Environment Variables** — dodaj:

| Nazwa zmiennej          | Wartość                                   | Skąd                                            |
|-------------------------|-------------------------------------------|-------------------------------------------------|
| `STRIPE_SECRET_KEY`     | `sk_test_…` lub `sk_live_…`               | Stripe → Developers → API keys → *Secret key*   |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…`                                 | Stripe → Developers → Webhooks (patrz niżej)    |

(Opcjonalnie `PUBLIC_BASE_URL`, np. `https://twojadomena.pl` — potrzebne tylko, gdy
adresy powrotu ze Stripe miałyby się źle wyliczać; zwykle nie trzeba go ustawiać.)

> **Uwaga:** klucz *publishable* (`pk_…`) nie jest tu potrzebny — używamy hostowanej
> strony Stripe Checkout, więc w kodzie strony nie ma żadnego klucza Stripe.

**Skonfigurowanie webhooka (żeby dostać `whsec_…`):**
1. Wdróż projekt na Vercel (żeby mieć adres produkcyjny, np. `https://twojadomena.pl`).
2. Stripe → **Developers → Webhooks → Add endpoint**.
3. **Endpoint URL:** `https://TWOJA-DOMENA/api/webhook`
4. **Events:** zaznacz `checkout.session.completed`
   (i opcjonalnie `checkout.session.async_payment_succeeded`).
5. Zapisz — Stripe pokaże **Signing secret** `whsec_…`. Wklej go do `STRIPE_WEBHOOK_SECRET`.
6. Po dodaniu/zmianie zmiennych zrób **Redeploy** (Deployments → Redeploy).

Po tym płatności działają w pełni: klient płaci, wraca na „dziękujemy", a zamówienie
widać w panelu `/admin` (sekcja **Zamówienia**).

**Alternatywy** (gdybyś kiedyś chciał zmienić podejście):
- **Shopify** (jest w Twoim biznesplanie) — przenieś produkty do Shopify i użyj ich checkout.
- Inna bramka (Przelewy24, PayU) — analogicznie podłącz w `api/checkout.js`.

### Zdjęcia produktów
Produkty mają teraz przykładowe zdjęcia z Unsplash (darmowe do użytku komercyjnego,
bez wymogu podawania autora). Ładują się na żywo w przeglądarce.
Każdy produkt ma też zapasowe tło CSS (`art`) — jeśli zdjęcie się nie wczyta,
automatycznie pokazuje się tło w kolorach marki (nic się nie „zepsuje").

**Podmiana na własne zdjęcia (zalecane):**
1. Wrzuć swoje foto do folderu `assets/`, np. `assets/polka-dab.jpg`.
2. W `js/main.js` w danym produkcie zmień pole `img`:
```js
{ name:"Półka z dębu", cat:"wood", tag:"Lite drewno", price:"590 zł",
  desc:"...", art:"w1", img:"assets/polka-dab.jpg" }
```
Zdjęcia lokalne z `assets/` są pewniejsze i szybsze niż linki zewnętrzne —
warto docelowo podmienić wszystkie na własne foto wyrobów.

### Zdjęcia tła (hero, kolekcje)
- `assets/hero-mountains.jpg` — tło strony głównej i podstrony „Warsztat".
- `assets/logo-scene.jpg` — tło kafla „Meble z drewna" i podstrony drewna.
- `assets/logo-bear.jpg` — tło kafla „Meble z poroża" i podstron poroża/kontakt.
Podmień te pliki (zachowując nazwy), aby zmienić tła bez ruszania kodu.

### Kolory / czcionki
Wszystkie kolory to zmienne CSS na górze `css/style.css` (`:root`). Zmień hex w jednym miejscu.

### Formularz kontaktowy
`kontakt.html` ma działający front, ale bez backendu (pokazuje tylko potwierdzenie).
Aby odbierać maile, podłącz np. [Formspree](https://formspree.io):
w `kontakt.html` zamień `<form id="contactForm">` na `<form action="https://formspree.io/f/TWOJE_ID" method="POST">`
i usuń `e.preventDefault()` w `initForm()` w `js/main.js`.

## Backend + panel admina (Vercel)

Do strony dołączony jest lekki backend napisany w Node.js jako **Vercel Functions**
(folder `api/`) oraz **panel admina** (`admin.html` → adres `/admin`) do dodawania,
edycji i usuwania produktów. Dane trzyma **baza Vercel Postgres**. Wszystko działa na
jednym koncie Vercel — nie trzeba osobnego serwera (Railway itp.).

### Jak to działa
- Sklep (`sklep.html`, kolekcje, strona produktu) pobiera produkty z `GET /api/products`.
- Jeśli backend/baza nie odpowiada, używana jest lista zapasowa z `js/main.js` — strona się nie zepsuje.
- Panel `/admin` (chroniony hasłem) robi operacje `POST/PUT/DELETE` na `/api/products`.
- Strona pojedynczego produktu jest teraz dynamiczna: `produkt.html?id=<id>` — dzięki temu
  każdy produkt dodany w panelu od razu ma swoją podstronę (stare pliki `produkt-*.html` zostają).

### Pliki backendu
```
api/
├── _lib.js            # połączenie z bazą, tworzenie tabeli, logowanie (podpisane ciasteczko)
├── login.js           # POST /api/login   — logowanie hasłem
├── logout.js          # POST /api/logout
├── session.js         # GET  /api/session — czy zalogowany
├── products.js        # GET (lista, publiczne) + POST (dodanie, admin)
├── products/[id].js   # GET / PUT / DELETE pojedynczego produktu
└── seed.js            # POST /api/seed — jednorazowy import startowych 9 produktów
```

### Konfiguracja krok po kroku (na Vercelu)
1. **Wgraj repo na Vercel** (Add New… → Project → import z GitHuba). Framework Preset: **Other**.
2. **Dodaj bazę:** w projekcie zakładka **Storage → Create Database → Postgres**, połącz z projektem.
   Vercel sam doda zmienną `POSTGRES_URL` do projektu.
3. **Ustaw zmienne środowiskowe** (Project → Settings → Environment Variables):
   - `ADMIN_PASSWORD` — Twoje hasło do panelu admina (ustaw własne, mocne).
   - `AUTH_SECRET` — losowy ciąg do podpisywania sesji, np. wynik `openssl rand -hex 32`.
   - `STRIPE_SECRET_KEY` — klucz sekretny Stripe (`sk_test_…` / `sk_live_…`) — płatności.
   - `STRIPE_WEBHOOK_SECRET` — sekret webhooka Stripe (`whsec_…`) — patrz sekcja „Płatności (Stripe)".
4. **Wdróż ponownie** (Deployments → Redeploy), żeby zmienne i baza były aktywne.
5. Wejdź na **`/admin`**, zaloguj się hasłem i kliknij **„Zaimportuj startowe 9 produktów"**
   (przycisk pojawia się, gdy baza jest pusta). Od tej pory zarządzasz produktami z panelu.

Tabela w bazie tworzy się automatycznie przy pierwszym zapytaniu (nie trzeba ręcznych migracji).

### Uruchomienie lokalne (opcjonalnie)
```bash
npm install
npm run dev        # uruchamia `vercel dev` (wymaga zainstalowanego Vercel CLI i podpiętej bazy)
```
Bez bazy strona i tak zadziała lokalnie (produkty z listy fallback), ale panel admina
będzie zgłaszał błąd zapisu — to normalne, dopóki nie ustawisz Postgresa i zmiennych.

### Zdjęcia produktów (upload w panelu)
W panelu `/admin`, w formularzu produktu, jest przycisk **„Wgraj zdjęcie…"**. Wybrany plik
(JPG/PNG) jest w przeglądarce automatycznie pomniejszany i kompresowany, a następnie
zapisywany **w bazie** (tabela `product_images`, kolumna BYTEA) — bez zewnętrznego storage
(R2, S3 itp.). Zdjęcie jest serwowane pod adresem `GET /api/img/<id>` z długim cache
(adres ma wersję `?v=`, więc po podmianie od razu widać nowe). Można też zamiast pliku
podać zwykły adres URL (sekcja „…albo użyj adresu URL zdjęcia"). Usunięcie produktu
kasuje też jego zdjęcie (ON DELETE CASCADE).

### Diagnostyka (gdy coś nie działa)
Wejdź na `/api/health` — zobaczysz, czy baza jest podłączona (`db.connected`), pod jaką
zmienną jest connection string (`dbUrlUsed`), w jakim trybie łączy się kod (`mode`: `pool`
lub `client`) oraz — gdy baza nie odpowiada — prawdziwy komunikat błędu (`db.error`).
Kod obsługuje zarówno connection string „pooled" (zalecany, przez pgbouncer), jak i „direct"
(wtedy używa pojedynczego klienta zamiast puli). Na produkcji najlepiej użyć w `POSTGRES_URL`
adresu **pooled** z zakładki Storage (host z „-pooler").

### Bezpieczeństwo
- Hasło admina jest sprawdzane po stronie serwera; sesja to podpisane ciasteczko `HttpOnly`
  (ważne 12 h). Nie trzymamy haseł w przeglądarce.
- Endpointy zapisujące (`POST/PUT/DELETE`, `seed`) wymagają zalogowania; odczyt `GET /api/products`
  jest publiczny (potrzebny do wyświetlania sklepu).
- Zmień `ADMIN_PASSWORD` i `AUTH_SECRET` na własne przed uruchomieniem produkcyjnym.

### Kolejne kroki (opcjonalnie, na przyszłość)
- **Upload zdjęć** zamiast wklejania URL — można dołożyć Vercel Blob (`@vercel/blob`).
- **Tłumaczenia nowych produktów** (PL/EN/DE) — obecnie nowy produkt pokazuje się w języku, w jakim
  go wpiszesz (fallback do danych z bazy). Docelowo pola opisu można rozbić na 3 języki.
- **Zamówienia i płatności** — działają przez Stripe (patrz sekcja „Płatności (Stripe)" powyżej).
  Ustaw `STRIPE_SECRET_KEY` i `STRIPE_WEBHOOK_SECRET`, a zamówienia zobaczysz w panelu `/admin`.

## Uwaga
Placeholdery produktów to tła generowane w CSS w kolorach marki. Podmień je na realne
zdjęcia swoich wyrobów (patrz wyżej), a strona od razu nabierze życia.
