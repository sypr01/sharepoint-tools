const { TableClient } = require("@azure/data-tables");

const TABLE     = "tickets";
const PARTITION = "IT";

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*"
};

function getClient() {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) throw new Error("Variable AZURE_STORAGE_CONNECTION_STRING no configurada en Application Settings.");
  return TableClient.fromConnectionString(conn, TABLE);
}

function entityToTicket(e) {
  return {
    id:                e.rowKey,
    titulo:            e.titulo            || "",
    descripcion:       e.descripcion       || "",
    categoria:         e.categoria         || "Otro",
    prioridad:         e.prioridad         || "Media",
    estado:            e.estado            || "Abierto",
    solicitante:       e.solicitante       || "",
    email:             e.email             || "",
    extension:         e.extension         || "",
    departamento:      e.departamento      || "",
    asignado:          e.asignado          || "",
    notas:             e.notas             || "",
    fechaCreacion:     e.fechaCreacion     || "",
    fechaActualizacion: e.fechaActualizacion || ""
  };
}

module.exports = async function (context, req) {
  const id = context.bindingData.id;
  if (!id) {
    context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: "ID de ticket requerido." }) };
    return;
  }

  try {
    const client = getClient();

    if (req.method === "GET") {
      const entity = await client.getEntity(PARTITION, id);
      context.res = { status: 200, headers: CORS, body: JSON.stringify(entityToTicket(entity)) };

    } else if (req.method === "PUT") {
      const body = req.body || {};
      const existing = await client.getEntity(PARTITION, id);
      const now = new Date().toISOString();
      const updated = {
        partitionKey:       PARTITION,
        rowKey:             id,
        titulo:             existing.titulo,
        descripcion:        existing.descripcion,
        categoria:          existing.categoria,
        prioridad:          body.prioridad  !== undefined ? body.prioridad  : existing.prioridad,
        estado:             body.estado     !== undefined ? body.estado     : existing.estado,
        solicitante:        existing.solicitante,
        email:              existing.email,
        extension:          existing.extension,
        departamento:       existing.departamento,
        asignado:           body.asignado   !== undefined ? body.asignado   : existing.asignado,
        notas:              body.notas      !== undefined ? body.notas      : existing.notas,
        fechaCreacion:      existing.fechaCreacion,
        fechaActualizacion: now
      };
      await client.updateEntity(updated, "Replace");
      context.res = { status: 200, headers: CORS, body: JSON.stringify(entityToTicket(updated)) };

    } else {
      context.res = { status: 405, headers: CORS, body: JSON.stringify({ error: "Método no permitido." }) };
    }
  } catch (e) {
    if (e.statusCode === 404) {
      context.res = { status: 404, headers: CORS, body: JSON.stringify({ error: "Ticket no encontrado." }) };
    } else {
      context.res = { status: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
    }
  }
};
