const { TableClient, AzureNamedKeyCredential } = require("@azure/data-tables");
const { verifyToken } = require('../lib/auth');

const TABLE     = "bovedaAudit";
const PARTITION = "IT";

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-PLG-Auth"
};

function getClient() {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) throw new Error("AZURE_STORAGE_CONNECTION_STRING no configurada.");
  const m1 = conn.match(/AccountName=([^;]+)/i);
  const m2 = conn.match(/AccountKey=([^;]+)/i);
  if (!m1 || !m2) throw new Error("Cadena de conexion invalida.");
  const url = `https://${m1[1]}.table.core.windows.net`;
  return new TableClient(url, TABLE, new AzureNamedKeyCredential(m1[1], m2[1]));
}

module.exports = async function (context, req) {
  if (req.method === "OPTIONS") {
    context.res = { status: 200, headers: CORS, body: "" };
    return;
  }

  const user = verifyToken(req);
  if (!user || !['admin', 'it_admin'].includes(user.rol)) {
    context.res = { status: 403, headers: CORS, body: JSON.stringify({ error: "Solo administradores IT." }) };
    return;
  }

  try {
    const client = getClient();
    await client.createTable().catch(() => {});
    const logs = [];
    for await (const e of client.listEntities()) {
      logs.push({
        id:            e.rowKey,
        accion:        e.accion        || "",
        sistemaId:     e.sistemaId     || "",
        sistemaNombre: e.sistemaNombre || "",
        usuarioId:     e.usuarioId     || "",
        usuarioNombre: e.usuarioNombre || "",
        fecha:         e.fecha         || e.timestamp || ""
      });
    }
    logs.sort((a, b) => b.fecha.localeCompare(a.fecha));
    context.res = { status: 200, headers: CORS, body: JSON.stringify(logs.slice(0, 500)) };
  } catch (e) {
    context.res = { status: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
