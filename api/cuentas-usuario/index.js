const { TableClient, AzureNamedKeyCredential } = require("@azure/data-tables");

const TABLE     = "usuarios";
const PARTITION = "IT";

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function getClient() {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) throw new Error("Variable AZURE_STORAGE_CONNECTION_STRING no configurada.");
  const m1 = conn.match(/AccountName=([^;]+)/i);
  const m2  = conn.match(/AccountKey=([^;]+)/i);
  if (!m1 || !m2) throw new Error("Cadena de conexion invalida.");
  const url = `https://${m1[1]}.table.core.windows.net`;
  return new TableClient(url, TABLE, new AzureNamedKeyCredential(m1[1], m2[1]));
}

function parseCuentas(raw) {
  try { return raw ? JSON.parse(raw) : []; } catch { return []; }
}

module.exports = async function (context, req) {
  if (req.method === "OPTIONS") {
    context.res = { status: 200, headers: CORS, body: "" };
    return;
  }

  const id = req.query.id;
  if (!id) {
    context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: "Se requiere el ID del usuario." }) };
    return;
  }

  try {
    const client = getClient();

    if (req.method === "GET") {
      const entity = await client.getEntity(PARTITION, id);
      context.res = { status: 200, headers: CORS, body: JSON.stringify(parseCuentas(entity.cuentas)) };

    } else if (req.method === "PUT") {
      const b = req.body || {};
      const cuentas = Array.isArray(b.cuentas) ? b.cuentas : [];
      await client.updateEntity({
        partitionKey: PARTITION,
        rowKey:       id,
        cuentas:      JSON.stringify(cuentas),
        fechaActualizacion: new Date().toISOString()
      }, "Merge");
      context.res = { status: 200, headers: CORS, body: JSON.stringify({ ok: true, cuentas }) };

    } else {
      context.res = { status: 405, headers: CORS, body: JSON.stringify({ error: "Método no permitido." }) };
    }
  } catch (e) {
    context.res = { status: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
