const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

module.exports = async function (context, req) {
  if (req.method === "OPTIONS") {
    context.res = { status: 200, headers: CORS, body: "" };
    return;
  }

  const { usuario, contrasena } = req.body || {};

  const validUser = process.env.PORTAL_USER;
  const validPass = process.env.PORTAL_PASS;

  if (!validUser || !validPass) {
    context.res = { status: 500, headers: CORS, body: JSON.stringify({ error: "Variables de entorno no configuradas." }) };
    return;
  }

  if (usuario === validUser && contrasena === validPass) {
    const token = Buffer.from(validUser + ":" + validPass + ":plg2026").toString("base64");
    context.res = { status: 200, headers: CORS, body: JSON.stringify({ ok: true, token }) };
  } else {
    context.res = { status: 401, headers: CORS, body: JSON.stringify({ ok: false, error: "Credenciales incorrectas." }) };
  }
};
