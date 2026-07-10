const { getSupabase } = require("./lib/supabase");

const SIGMA_BASE    = "https://api.sigmapayments.com.br/api/v1";
const SIGMA_API_KEY = process.env.SIGMA_API_KEY;

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

function normalizeAmountCents(rawAmount) {
  if (rawAmount == null) return 8170;
  const n = Number(rawAmount);
  if (!Number.isFinite(n)) return 8170;
  if (!Number.isInteger(n)) return Math.round(n * 100);
  if (n < 100) return Math.round(n * 100);
  return Math.round(n);
}

function gerarCpfValido() {
  const n = () => Math.floor(Math.random() * 9);
  const d = Array.from({ length: 9 }, n);
  let s1 = d.reduce((a, v, i) => a + v * (10 - i), 0);
  let r1 = (s1 * 10) % 11; if (r1 >= 10) r1 = 0;
  d.push(r1);
  let s2 = d.reduce((a, v, i) => a + v * (11 - i), 0);
  let r2 = (s2 * 10) % 11; if (r2 >= 10) r2 = 0;
  d.push(r2);
  return d.join('');
}

async function postWithRetry(url, payload, headers) {
  const delays = [1000, 2000, 4000];
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (resp.status >= 400 && resp.status < 500) return resp;
      if (resp.ok) return resp;
      lastErr = new Error(`HTTP ${resp.status}`);
    } catch (err) {
      clearTimeout(timeout);
      lastErr = err;
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, delays[attempt]));
  }
  throw lastErr;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      },
      body: "",
    };
  }

  let body = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch { body = {}; }

  const randDigits = (len) => Array.from({ length: len }, () => Math.floor(Math.random() * 10)).join("");
  const randId = randDigits(6);

  const rawAmount   = body.amount ?? body.valor ?? body.total ?? 3840;
  const amountCents = normalizeAmountCents(rawAmount);

  const customerName  = (body.nome || body.name || body.customer_name || `Cliente ${randId}`).toString().trim();
  const customerEmail = (body.email || body.customer_email || `cliente${randId}@gmail.com`).toString().trim();
  const rawPhone      = (body.phone || body.customer_phone || `11${randDigits(9)}`).toString().replace(/\D/g, "");
  const customerPhone = rawPhone.startsWith("55") ? `+${rawPhone}` : `+55${rawPhone}`;
  const cpfRaw        = (body.cpf || body.document || body.customer_cpf || "").toString().replace(/\D/g, "");
  const customerCpf   = cpfRaw.length === 11 ? cpfRaw : gerarCpfValido();

  const payload = {
    amount:        amountCents,
    description:   "50000 musicas pen drive DJ",
    paymentMethod: "pix",
    customer: {
      name:     customerName,
      email:    customerEmail,
      document: customerCpf,
      phone:    customerPhone,
    },
  };

  const headers = {
    "Content-Type": "application/json",
    "X-API-Key":    SIGMA_API_KEY,
  };

  let resp;
  try {
    resp = await postWithRetry(`${SIGMA_BASE}/direct-payments`, payload, headers);
  } catch (err) {
    return jsonResponse(502, { success: false, error: "Falha ao conectar com gateway: " + String(err) });
  }

  const text = await resp.text();
  if (!resp.ok) {
    return jsonResponse(resp.status, { success: false, error: text || "Erro ao criar cobrança PIX", raw: text });
  }

  let parsed = {};
  try { parsed = JSON.parse(text); } catch {
    return jsonResponse(500, { success: false, error: "Resposta inválida da gateway", raw: text });
  }

  const data = parsed.data || parsed;

  const transactionId = data.transaction_id || data.id || null;
  const pixCode       = data.payment_data?.pix_key || data.pix_code || data.brcode || null;

  try {
    const supabase = getSupabase();
    await supabase.from("transactions").insert({
      transaction_id: transactionId,
      amount:         amountCents / 100,
      customer_name:  customerName,
      customer_email: customerEmail,
      customer_cpf:   customerCpf,
      customer_phone: rawPhone,
      status:         "PENDING",
      brcode:         pixCode,
    });
  } catch (_) {}

  return jsonResponse(200, {
    success:        true,
    pixCode,
    pix_code:       pixCode,
    brcode:         pixCode,
    payload:        pixCode,
    qr_code_image:  null,
    transaction_id: transactionId,
    transactionId,
    deposit_id:     transactionId,
    status:         data.status || "PENDING",
  });
};
