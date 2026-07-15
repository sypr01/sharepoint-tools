const { TableClient, AzureNamedKeyCredential } = require("@azure/data-tables");

const TABLE     = "inventario";
const PARTITION = "IT";

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*"
};

function getClient() {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) throw new Error("Variable AZURE_STORAGE_CONNECTION_STRING no configurada.");
  const accountNameMatch = conn.match(/AccountName=([^;]+)/i);
  const accountKeyMatch  = conn.match(/AccountKey=([^;]+)/i);
  if (!accountNameMatch || !accountKeyMatch) throw new Error("Cadena de conexion invalida.");
  const accountName = accountNameMatch[1];
  const accountKey  = accountKeyMatch[1];
  const url = `https://${accountName}.table.core.windows.net`;
  return new TableClient(url, TABLE, new AzureNamedKeyCredential(accountName, accountKey));
}

function entityToItem(e) {
  return {
    id:               e.rowKey,
    tipo:             e.tipo             || "",
    marca:            e.marca            || "",
    modelo:           e.modelo           || "",
    serial:           e.serial           || "",
    estado:           e.estado           || "",
    division:         e.division         || "",
    usuarioAnterior:  e.usuarioAnterior  || "",
    usuarioActual:    e.usuarioActual    || "",
    usuarioId:        e.usuarioId        || "",
    notas:            e.notas            || "",
    fechaIngreso:     e.fechaIngreso     || "",
    fechaActualizacion: e.fechaActualizacion || ""
  };
}

module.exports = async function (context, req) {
  try {
    const client = getClient();
    await client.createTable().catch(() => {});

    if (req.method === "GET") {
      const list = [];
      for await (const e of client.listEntities()) {
        list.push(entityToItem(e));
      }
      list.sort((a, b) => (a.tipo + a.marca).localeCompare(b.tipo + b.marca));
      context.res = { status: 200, headers: CORS, body: JSON.stringify(list) };

    } else if (req.method === "POST") {
      const body = req.body || {};
      if (!body.tipo || !body.serial) {
        context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: "Los campos 'tipo' y 'serial' son obligatorios." }) };
        return;
      }
      const now    = new Date().toISOString();
      const rowKey = "INV-" + Date.now() + "-" + Math.random().toString(36).substr(2, 4).toUpperCase();
      const entity = {
        partitionKey:       PARTITION,
        rowKey,
        tipo:               body.tipo              || "",
        marca:              body.marca             || "",
        modelo:             body.modelo            || "",
        serial:             body.serial            || "",
        estado:             body.estado            || "Bueno",
        division:           body.division          || "",
        usuarioAnterior:    body.usuarioAnterior   || "",
        usuarioActual:      body.usuarioActual     || "",
        usuarioId:          body.usuarioId         || "",
        notas:              body.notas             || "",
        fechaIngreso:       now,
        fechaActualizacion: now
      };
      await client.createEntity(entity);
      context.res = { status: 201, headers: CORS, body: JSON.stringify(entityToItem(entity)) };

    } else if (req.method === "PUT") {
      const id   = req.query.id || (req.body && req.body.id);
      const body = req.body || {};
      if (!id) {
        context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: "Se requiere el ID del equipo." }) };
        return;
      }
      const existing = await client.getEntity(PARTITION, id);
      const now = new Date().toISOString();
      const updated = {
        partitionKey:       PARTITION,
        rowKey:             id,
        tipo:               body.tipo             ?? existing.tipo             ?? "",
        marca:              body.marca            ?? existing.marca            ?? "",
        modelo:             body.modelo           ?? existing.modelo           ?? "",
        serial:             body.serial           ?? existing.serial           ?? "",
        estado:             body.estado           ?? existing.estado           ?? "",
        division:           body.division         ?? existing.division         ?? "",
        usuarioAnterior:    body.usuarioAnterior  ?? existing.usuarioAnterior  ?? "",
        usuarioActual:      body.usuarioActual    ?? existing.usuarioActual    ?? "",
        usuarioId:          body.usuarioId        ?? existing.usuarioId        ?? "",
        notas:              body.notas            ?? existing.notas            ?? "",
        fechaIngreso:       existing.fechaIngreso || now,
        fechaActualizacion: now
      };
      await client.updateEntity(updated, "Replace");
      context.res = { status: 200, headers: CORS, body: JSON.stringify(entityToItem(updated)) };

    } else if (req.method === "DELETE") {
      const id = req.query.id;
      if (!id) {
        context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: "Se requiere el ID del equipo." }) };
        return;
      }
      await client.deleteEntity(PARTITION, id);
      context.res = { status: 200, headers: CORS, body: JSON.stringify({ ok: true }) };

    } else {
      context.res = { status: 405, headers: CORS, body: JSON.stringify({ error: "Método no permitido." }) };
    }
  } catch (e) {
    context.res = { status: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
