# ANTLERWOOD — strona firmowa

Statyczna strona (HTML/CSS/JS, bez frameworków i bez build-stepu). Gotowa do wrzucenia na Vercel.

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
Koszyk działa w pamięci przeglądarki podczas sesji (znika po odświeżeniu strony) — to wersja
demonstracyjna bez backendu i płatności. Przycisk „Przejdź do kasy" pokazuje komunikat demo.

**Aby uruchomić prawdziwą sprzedaż**, masz dwie drogi:
1. **Shopify** (jest w Twoim biznesplanie) — przenieś produkty do Shopify i użyj ich koszyka/checkout.
2. **Bramka płatności** (np. Stripe, Przelewy24, PayU) — podłącz `#cartCheckout` w `js/main.js`
   do utworzenia sesji płatności na swoim serwerze.

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

## Uwaga
Placeholdery produktów to tła generowane w CSS w kolorach marki. Podmień je na realne
zdjęcia swoich wyrobów (patrz wyżej), a strona od razu nabierze życia.
