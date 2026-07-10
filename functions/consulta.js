const CPF_API_BASE = "https://api-apela.online/";
const DEFAULT_CPF_API_USER = "abd603cd5af108938f6bca10cba1e6e1";

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

function extractCpfData(payload, cpf) {
  const root = payload?.data || payload?.DADOS || payload || {};
  return {
    cpf: cpf || String(root.cpf || "").replace(/\D/g, ""),
    nome: root.nome || root.name || "",
    nome_mae: root.mae || root.nome_mae || root.nomeMae || "",
    data_nascimento: root.nascimento || root.data_nascimento || root.dataNascimento || "",
    sexo: root.sexo || root.genero || root.gender || "",
  };
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

  const cpfRaw = event.queryStringParameters?.cpf || "";
  const cpf = cpfRaw.replace(/\D/g, "").slice(0, 11);
  if (!cpf) {
    return jsonResponse(400, { status: 400, statusMsg: "Informe o CPF" });
  }

  const user =
    process.env.CPF_API_USER ||
    process.env.CPF_API_TOKEN ||
    DEFAULT_CPF_API_USER;

  const apiUrl = `${CPF_API_BASE}?user=${encodeURIComponent(user)}&cpf=${cpf}`;

  let apiResp;
  let text = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      apiResp = await fetch(apiUrl, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      text = await apiResp.text();
      if (apiResp.ok) break;
    } catch (error) {
      if (attempt === 3) {
        return jsonResponse(502, {
          status: 502,
          statusMsg: "Falha ao consultar CPF",
          details: String(error),
        });
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    return jsonResponse(502, {
      status: 502,
      statusMsg: "Resposta invalida da API de CPF",
      details: text.slice(0, 200),
    });
  }

  if (data.status === 404 || (data.erro && data.status !== 200)) {
    return jsonResponse(404, {
      status: 404,
      statusMsg: data.erro || "CPF nao encontrado",
    });
  }

  if (data.status && data.status !== 200) {
    return jsonResponse(data.status, {
      status: data.status,
      statusMsg: data.erro || data.error || "Erro na consulta de CPF",
    });
  }

  if (!data.nome) {
    return jsonResponse(404, { status: 404, statusMsg: "CPF nao encontrado" });
  }

  const dados = extractCpfData(data, cpf);
  return jsonResponse(200, { DADOS: dados });
};
