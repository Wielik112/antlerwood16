# Płatności — Przelewy24, PayU, Tpay (instrukcja krok po kroku)

Ten dokument mówi **dokładnie gdzie wejść i co wpisać**, żeby uruchomić trzy polskie
bramki płatności obok istniejącego Stripe. Kod jest już w projekcie i sterowany
zmiennymi środowiskowymi — bramka pojawia się na koszyku dopiero wtedy, gdy wpiszesz
jej klucze na Vercelu.

> **Ważne, żebyś wiedział/a od razu:** Przelewy24, PayU i Tpay robią klientowi *to samo*
> (BLIK + wszystkie polskie przelewy + karty). Trzy osobne = trzy umowy, trzy prowizje,
> trzy panele do rozliczeń. Jeśli kiedyś zechcesz to uprościć — wystarczyłaby jedna z nich.
> Robimy trzy, bo tak wybrałeś/aś.

---

## Jak to działa (w skrócie)

1. Klient na `koszyk.html` wybiera metodę (np. „Przelewy24"), podaje e-mail, region
   wysyłki i adres, klika **Zapłać**.
2. Backend (`/api/pay/create`) liczy kwotę **z bazy** (nie z przeglądarki), dolicza
   wysyłkę, zapisuje zamówienie jako `pending` i tworzy transakcję w bramce.
3. Klient płaci na stronie bramki i wraca na `dziekujemy.html?order=...`.
4. Bramka niezależnie wysyła **powiadomienie** na `/api/pay/notify?provider=...`.
   Dopiero zweryfikowane powiadomienie oznacza zamówienie jako `paid`.
5. Zamówienia widać tak samo jak dotąd (tabela `orders`, panel `/admin.html`).

Pliki: `api/pay/_providers.js` (logika bramek), `api/pay/create.js`,
`api/pay/notify.js`, `api/pay/status.js`, `api/pay/methods.js`.

---

## Krok 0 — adresy, które będą Ci potrzebne

Zamień `twojadomena.pl` na Twój prawdziwy adres (albo adres z Vercela typu
`nazwa.vercel.app`). Te adresy wklejasz w panelach bramek:

| Do czego | Adres |
|---|---|
| Powiadomienie Przelewy24 | `https://twojadomena.pl/api/pay/notify?provider=przelewy24` |
| Powiadomienie PayU | `https://twojadomena.pl/api/pay/notify?provider=payu` |
| Powiadomienie Tpay | `https://twojadomena.pl/api/pay/notify?provider=tpay` |
| Powrót klienta (wszystkie) | `https://twojadomena.pl/dziekujemy.html` |

> Uwaga: te bramki wymagają publicznego adresu **https**. Na `localhost` powiadomienia
> nie dojdą — testuj na wdrożeniu Vercel (może być darmowy `*.vercel.app`).

---

## Gdzie wpisuje się klucze (dotyczy wszystkich trzech)

1. Wejdź na **vercel.com** → Twój projekt → zakładka **Settings**.
2. Menu po lewej → **Environment Variables**.
3. Dla każdej zmiennej: **Key** = nazwa (np. `P24_CRC`), **Value** = wartość z panelu
   bramki, **Environment** = zaznacz **Production** (i **Preview**, jeśli chcesz testy).
4. Po dodaniu wszystkich → zakładka **Deployments** → przy ostatnim wdrożeniu menu „…”
   → **Redeploy**. Bez redeployu nowe klucze nie zadziałają.

Pełną listę nazw masz w pliku `.env.example`.

---

## 1) PRZELEWY24

### Rejestracja
1. Wejdź na **przelewy24.pl** → **Zarejestruj się / Załóż konto**.
2. Wypełnij dane firmy, podpisz umowę online, poczekaj na aktywację.
3. Do testów możesz od razu użyć **panelu sandbox**: `sandbox.przelewy24.pl`
   (osobne, darmowe konto testowe — polecam zacząć od niego).

### Skąd wziąć klucze (panel → Konfiguracja / Ustawienia)
- **ID sprzedawcy** (Merchant ID) → zmienna `P24_MERCHANT_ID`
- **CRC** (Konfiguracja → Bezpieczeństwo / Klucz CRC) → `P24_CRC`
- **Klucz do REST API** (Konfiguracja → API / „Klucz do raportów") → `P24_API_KEY`
- `P24_POS_ID` zostaw puste lub takie samo jak Merchant ID.
- `P24_SANDBOX=1` na czas testów, `0` na produkcji.

### Konfiguracja w panelu P24
- W ustawieniach API włącz REST API.
- Adres powiadomień podajemy automatycznie przy każdej transakcji, więc **nie musisz**
  nic wpisywać ręcznie. Jeśli panel wymaga adresu URL powiadomień/„webhook", wklej:
  `https://twojadomena.pl/api/pay/notify?provider=przelewy24`.

---

## 2) PayU

### Rejestracja
1. Wejdź na **payu.pl** → **Załóż konto / Dla biznesu**.
2. Podpisz umowę, przejdź weryfikację firmy.
3. Do testów użyj **PayU Sandbox**: `secure.snd.payu.com` (konto testowe w panelu
   deweloperskim PayU). Zacznij od sandboxa.

### Skąd wziąć klucze (Panel PayU → Ustawienia → Punkty płatności / Klucze API)
- **POS ID** (identyfikator punktu płatności) → `PAYU_POS_ID`
- **Client Secret** (protokół OAuth) → `PAYU_CLIENT_SECRET`
- **Drugi klucz (MD5)** → `PAYU_MD5_KEY` (służy do weryfikacji powiadomień)
- `PAYU_CLIENT_ID` zostaw puste (użyje POS ID) lub wpisz `client_id` z OAuth.
- `PAYU_SANDBOX=1` do testów, `0` na produkcji.

### Konfiguracja w panelu PayU
- W ustawieniach punktu płatności ustaw **adres powiadomień (notifyUrl)**:
  `https://twojadomena.pl/api/pay/notify?provider=payu`
  (kod i tak wysyła ten adres przy każdym zamówieniu, ale warto go też ustawić w panelu).

---

## 3) Tpay

### Rejestracja
1. Wejdź na **tpay.com** → **Załóż konto / Rejestracja**.
2. Podpisz umowę i przejdź weryfikację.
3. Tpay udostępnia **sandbox** (konto testowe) — zacznij od niego.

### Skąd wziąć klucze (Panel Tpay → Ustawienia → API / Integracja → OpenAPI)
- **client_id** → `TPAY_CLIENT_ID`
- **client_secret** → `TPAY_CLIENT_SECRET`
- **Kod bezpieczeństwa powiadomień** (Ustawienia → Powiadomienia / Notyfikacje) →
  `TPAY_NOTIFY_SECRET`
- `TPAY_SANDBOX=1` do testów, `0` na produkcji.

### Konfiguracja w panelu Tpay
- W **Ustawienia → Powiadomienia** ustaw **adres powiadomień**:
  `https://twojadomena.pl/api/pay/notify?provider=tpay`
- Ustaw typ powiadomień na **podstawowy / z sumą MD5** (nie JWS) — kod weryfikuje
  `md5sum` z użyciem `TPAY_NOTIFY_SECRET`. Skopiuj ten kod bezpieczeństwa do zmiennej.

---

## Krok końcowy — test

1. Ustaw klucze **sandbox** wszystkich trzech bramek na Vercelu (`*_SANDBOX=1`) i zrób
   **Redeploy**.
2. Wejdź na `koszyk.html` → pod przyciskiem Stripe pojawią się przyciski
   **Przelewy24 / PayU / Tpay** (tylko te, które mają klucze).
3. Dodaj produkt, wybierz metodę, podaj e-mail + adres, kliknij **Zapłać**.
4. Zapłać danymi testowymi bramki (BLIK testowy / karta testowa — z dokumentacji
   sandboxa danej bramki).
5. Sprawdź, że wracasz na `dziekujemy.html` i że zamówienie ma status `paid`
   (panel `/admin.html` albo tabela `orders`).
6. Gdy wszystko działa: zmień wszystkie `*_SANDBOX` na `0`, wpisz klucze **produkcyjne**
   i zrób **Redeploy**.

### Gdy coś nie działa
- Zamówienie zostaje `pending` → nie doszło powiadomienie. Sprawdź adres notify w panelu
  bramki i logi w **Vercel → Deployments → Functions → Logs** (szukaj `[pay/notify]`).
- „Metoda … nie jest skonfigurowana" → brakuje którejś zmiennej lub nie zrobiono Redeploy.
- Zły podpis w logach → zły `P24_CRC` / `PAYU_MD5_KEY` / `TPAY_NOTIFY_SECRET`
  albo pomylony tryb sandbox/produkcja.

> Uwaga na koniec: kod jest napisany zgodnie z dokumentacją API każdej bramki, ale
> **musi zostać przetestowany w sandboxie po założeniu kont** — dopiero prawdziwe
> odpowiedzi bramek potwierdzą, że wszystko gra (czasem panele różnią się nazwami pól).
