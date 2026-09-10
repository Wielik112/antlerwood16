// Wspólny moduł trzech polskich bramek płatności: Przelewy24, PayU, Tpay.
// Każda bramka to osobny obiekt z metodami:
//   isConfigured()                       -> czy ustawione są wymagane zmienne środowiskowe
//   createTransaction(ctx)               -> { redirectUrl, providerRef } (rejestracja płatności)
//   parseNotification(req, raw, body)    -> { orderId, providerRef, paid } (odbiór powiadomienia)
//
// WAŻNE (pieniądze):
//   - Kwota ZAWSZE liczona po stronie serwera z bazy (patrz api/pay/create.js). Bramka
//     dostaje tylko gotową kwotę — nie ufamy niczemu z przeglądarki.
//   - Powiadomienia (notify) są weryfikowane podpisem/hashem bramki, zanim uznamy
//     zamówienie za opłacone. Bez poprawnego podpisu → odrzucamy.
//
// Kwoty w tym module przekazujemy w GROSZACH (integer). Konwersję na format danej
// bramki robimy lokalnie (P24/PayU liczą w groszach, Tpay w złotych z kropką).

const crypto = require('crypto');

// ---------- helpers ----------

function sha384Hex(str) {
  return crypto.createHash('sha384').update(str, 'utf8').digest('hex');
}
function md5Hex(str) {
  return crypto.createHash('md5').update(str, 'utf8').digest('hex');
}
function envFlag(v) {
  return /^(1|true|yes|on)$/i.test(String(v || '').trim());
}
// Język w formacie akceptowanym przez większość bramek (pl/en/de).
function lang3(lang) {
  const l = String(lang || '').toLowerCase();
  return (l === 'pl' || l === 'en' || l === 'de') ? l : 'pl';
}

// =====================================================================
//  PRZELEWY24  (REST API v1)
//  Docs: https://developers.przelewy24.pl/
//  Zmienne: P24_MERCHANT_ID, P24_POS_ID (opcjonalnie, domyślnie = merchant id),
//           P24_CRC, P24_API_KEY, P24_SANDBOX
// =====================================================================
const przelewy24 = {
  id: 'przelewy24',
  label: 'Przelewy24',

  cfg() {
    const merchantId = parseInt(process.env.P24_MERCHANT_ID || '0', 10);
    const posId = parseInt(process.env.P24_POS_ID || process.env.P24_MERCHANT_ID || '0', 10);
    return {
      merchantId,
      posId,
      crc: process.env.P24_CRC || '',
      apiKey: process.env.P24_API_KEY || '',
      sandbox: envFlag(process.env.P24_SANDBOX),
      base: envFlag(process.env.P24_SANDBOX)
        ? 'https://sandbox.przelewy24.pl'
        : 'https://secure.przelewy24.pl',
    };
  },

  isConfigured() {
    const c = this.cfg();
    return !!(c.merchantId && c.crc && c.apiKey);
  },

  authHeader(c) {
    const token = Buffer.from(`${c.posId}:${c.apiKey}`).toString('base64');
    return `Basic ${token}`;
  },

  async createTransaction(ctx) {
    const c = this.cfg();
    // Podpis rejestracji: SHA-384 z JSON o ustalonej kolejności kluczy.
    const sign = sha384Hex(JSON.stringify({
      sessionId: ctx.order,
      merchantId: c.merchantId,
      amount: ctx.amount,
      currency: 'PLN',
      crc: c.crc,
    }));
    const payload = {
      merchantId: c.merchantId,
      posId: c.posId,
      sessionId: ctx.order,
      amount: ctx.amount, // grosze
      currency: 'PLN',
      description: ctx.description,
      email: ctx.email,
      country: 'PL',
      language: lang3(ctx.lang),
      urlReturn: ctx.returnUrl,
      urlStatus: ctx.notifyUrl,
      sign,
      encoding: 'UTF-8',
    };
    const r = await fetch(`${c.base}/api/v1/transaction/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: this.authHeader(c) },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.data || !data.data.token) {
      throw new Error(`P24 register: ${r.status} ${JSON.stringify(data).slice(0, 300)}`);
    }
    return {
      redirectUrl: `${c.base}/trnRequest/${data.data.token}`,
      providerRef: data.data.token,
    };
  },

  // Powiadomienie (urlStatus): P24 wysyła JSON. Weryfikujemy podpis, a następnie
  // POTWIERDZAMY transakcję przez /transaction/verify (dopiero to = opłacone).
  async parseNotification(req, raw, body) {
    const c = this.cfg();
    const n = body || {};
    const expected = sha384Hex(JSON.stringify({
      merchantId: n.merchantId,
      posId: n.posId,
      sessionId: n.sessionId,
      amount: n.amount,
      originAmount: n.originAmount,
      currency: n.currency,
      orderId: n.orderId,
      methodId: n.methodId,
      statement: n.statement,
      crc: c.crc,
    }));
    if (!n.sign || n.sign !== expected) {
      throw new Error('P24 notify: zły podpis (sign).');
    }
    // Potwierdzenie transakcji.
    const verifySign = sha384Hex(JSON.stringify({
      sessionId: n.sessionId,
      orderId: n.orderId,
      amount: n.amount,
      currency: 'PLN',
      crc: c.crc,
    }));
    const vr = await fetch(`${c.base}/api/v1/transaction/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: this.authHeader(c) },
      body: JSON.stringify({
        merchantId: c.merchantId,
        posId: c.posId,
        sessionId: n.sessionId,
        amount: n.amount,
        currency: 'PLN',
        orderId: n.orderId,
        sign: verifySign,
      }),
    });
    const vd = await vr.json().catch(() => ({}));
    const ok = vr.ok && vd.data && vd.data.status === 'success';
    return {
      orderId: String(n.sessionId || ''),
      providerRef: String(n.orderId || ''),
      amount: Number(n.amount) || 0,
      paid: !!ok,
    };
  },
};

// =====================================================================
//  PayU  (REST API v2.1)
//  Docs: https://developers.payu.com/
//  Zmienne: PAYU_POS_ID, PAYU_CLIENT_ID (opc., domyślnie = POS ID),
//           PAYU_CLIENT_SECRET, PAYU_MD5_KEY (drugi klucz / signature), PAYU_SANDBOX
// =====================================================================
const payu = {
  id: 'payu',
  label: 'PayU',

  cfg() {
    const sandbox = envFlag(process.env.PAYU_SANDBOX);
    return {
      posId: process.env.PAYU_POS_ID || '',
      clientId: process.env.PAYU_CLIENT_ID || process.env.PAYU_POS_ID || '',
      clientSecret: process.env.PAYU_CLIENT_SECRET || '',
      md5Key: process.env.PAYU_MD5_KEY || '',
      sandbox,
      base: sandbox ? 'https://secure.snd.payu.com' : 'https://secure.payu.com',
    };
  },

  isConfigured() {
    const c = this.cfg();
    return !!(c.posId && c.clientSecret && c.md5Key);
  },

  async getToken(c) {
    const r = await fetch(`${c.base}/pl/standard/user/oauth/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: c.clientId,
        client_secret: c.clientSecret,
      }).toString(),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.access_token) {
      throw new Error(`PayU oauth: ${r.status} ${JSON.stringify(data).slice(0, 200)}`);
    }
    return data.access_token;
  },

  async createTransaction(ctx) {
    const c = this.cfg();
    const token = await this.getToken(c);
    const payload = {
      notifyUrl: ctx.notifyUrl,
      continueUrl: ctx.returnUrl,
      customerIp: ctx.clientIp || '127.0.0.1',
      merchantPosId: c.posId,
      description: ctx.description,
      currencyCode: 'PLN',
      totalAmount: String(ctx.amount), // grosze jako string
      extOrderId: ctx.order,           // nasze id — do idempotencji i dopasowania
      buyer: { email: ctx.email, language: lang3(ctx.lang) },
      products: [{ name: ctx.description, unitPrice: String(ctx.amount), quantity: '1' }],
    };
    // PayU odpowiada 302 + JSON z redirectUri — nie podążamy za przekierowaniem.
    const r = await fetch(`${c.base}/api/v2_1/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
      redirect: 'manual',
    });
    const data = await r.json().catch(() => ({}));
    if (!data.redirectUri) {
      throw new Error(`PayU order: ${r.status} ${JSON.stringify(data).slice(0, 300)}`);
    }
    return { redirectUrl: data.redirectUri, providerRef: String(data.orderId || '') };
  },

  // Powiadomienie: PayU wysyła JSON { order: {...} } + nagłówek OpenPayu-Signature.
  // Weryfikacja: md5(surowe_body + drugi_klucz) === signature z nagłówka.
  parseNotification(req, raw, body) {
    const c = this.cfg();
    const header = req.headers['openpayu-signature'] || req.headers['x-openpayu-signature'] || '';
    const parts = {};
    String(header).split(';').forEach((kv) => {
      const i = kv.indexOf('=');
      if (i > -1) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
    });
    const rawStr = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '');
    const expected = md5Hex(rawStr + c.md5Key);
    if (!parts.signature || parts.signature.toLowerCase() !== expected.toLowerCase()) {
      throw new Error('PayU notify: zły podpis (OpenPayu-Signature).');
    }
    const order = (body && body.order) || {};
    const status = String(order.status || '').toUpperCase();
    return {
      orderId: String(order.extOrderId || ''),
      providerRef: String(order.orderId || ''),
      amount: Number(order.totalAmount) || 0,
      paid: status === 'COMPLETED',
    };
  },
};

// =====================================================================
//  Tpay  (OpenAPI)
//  Docs: https://openapi.tpay.com/
//  Zmienne: TPAY_CLIENT_ID, TPAY_CLIENT_SECRET, TPAY_NOTIFY_SECRET
//           (kod bezpieczeństwa powiadomień z panelu), TPAY_SANDBOX
// =====================================================================
const tpay = {
  id: 'tpay',
  label: 'Tpay',

  cfg() {
    const sandbox = envFlag(process.env.TPAY_SANDBOX);
    return {
      clientId: process.env.TPAY_CLIENT_ID || '',
      clientSecret: process.env.TPAY_CLIENT_SECRET || '',
      notifySecret: process.env.TPAY_NOTIFY_SECRET || '',
      sandbox,
      base: process.env.TPAY_API_BASE
        || (sandbox ? 'https://openapi.sandbox.tpay.com' : 'https://api.tpay.com'),
    };
  },

  isConfigured() {
    const c = this.cfg();
    return !!(c.clientId && c.clientSecret);
  },

  async getToken(c) {
    const r = await fetch(`${c.base}/oauth/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: c.clientId,
        client_secret: c.clientSecret,
      }).toString(),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.access_token) {
      throw new Error(`Tpay oauth: ${r.status} ${JSON.stringify(data).slice(0, 200)}`);
    }
    return data.access_token;
  },

  async createTransaction(ctx) {
    const c = this.cfg();
    const token = await this.getToken(c);
    const payload = {
      amount: Number((ctx.amount / 100).toFixed(2)), // Tpay liczy w złotych (kropka)
      description: ctx.description,
      hiddenDescription: ctx.order, // wraca w powiadomieniu jako tr_crc
      payer: { email: ctx.email, name: ctx.name || ctx.email },
      callbacks: {
        payerUrls: { success: ctx.returnUrl, error: ctx.returnUrl },
        notification: { url: ctx.notifyUrl },
      },
    };
    const r = await fetch(`${c.base}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.transactionPaymentUrl) {
      throw new Error(`Tpay transaction: ${r.status} ${JSON.stringify(data).slice(0, 300)}`);
    }
    return {
      redirectUrl: data.transactionPaymentUrl,
      providerRef: String(data.transactionId || ''),
    };
  },

  // Powiadomienie: Tpay wysyła form-encoded POST z md5sum.
  // md5sum = md5(id + tr_id + tr_amount + tr_crc + kod_bezpieczeństwa)
  parseNotification(req, raw, body) {
    const c = this.cfg();
    const n = body || {};
    const expected = md5Hex(
      String(n.id || '') + String(n.tr_id || '') + String(n.tr_amount || '')
      + String(n.tr_crc || '') + c.notifySecret,
    );
    if (c.notifySecret && (!n.md5sum || String(n.md5sum).toLowerCase() !== expected.toLowerCase())) {
      throw new Error('Tpay notify: zły md5sum.');
    }
    const paid = String(n.tr_status).toUpperCase() === 'TRUE'
      || String(n.tr_status) === 'true'
      || (n.tr_paid && n.tr_amount && Number(n.tr_paid) >= Number(n.tr_amount));
    return {
      orderId: String(n.tr_crc || ''),      // = nasze hiddenDescription
      providerRef: String(n.tr_id || ''),
      amount: Math.round((Number(n.tr_amount) || 0) * 100), // złote → grosze
      paid: !!paid,
    };
  },
};

// ---------- rejestr ----------

const PROVIDERS = { przelewy24, payu, tpay };

function getProvider(id) {
  return PROVIDERS[String(id || '').toLowerCase()] || null;
}

// Lista bramek gotowych do użycia (dla frontendu — pokazujemy tylko skonfigurowane).
function availableProviders() {
  return Object.values(PROVIDERS)
    .filter((p) => p.isConfigured())
    .map((p) => ({ id: p.id, label: p.label }));
}

module.exports = { getProvider, availableProviders, PROVIDERS };
