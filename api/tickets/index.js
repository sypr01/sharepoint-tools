const { TableClient } = require("@azure/data-tables");
const { notificarNuevoTicket, confirmarAlSolicitante } = require("../mailer");

const TABLE     = "tickets";
const PARTITION = "IT";

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*"
};

function getClient() {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) throw new Error("Variable AZURE_STORAGE_CONNECTION_STRING no configurada.");
  // Extraer AccountName y AccountKey de la cadena de conexion
  const accountNameMatch = conn.match(/AccountName=([^;]+)/i);
  const accountKeyMatch  = conn.match(/AccountKey=([^;]+)/i);
  if (!accountNameMatch || !accountKeyMatch) {
    throw new Error("Cadena de conexion invalida. Debe contener AccountName y AccountKey.");
  }
  const accountName = accountNameMatch[1];
  const accountKey  = accountKeyMatch[1];
  const url = `https://${accountName}.table.core.windows.net`;
  const { AzureNamedKeyCredential } = require("@azure/data-tables");
  const credential = new AzureNamedKeyCredential(accountName, accountKey);
  return new TableClient(url, TABLE, credential);
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
  try {
    const client = getClient();
    await client.createTable().catch(() => {});

    if (req.method === "GET") {
      const list = [];
      for await (const entity of client.listEntities({
        queryOptions: { filter: `PartitionKey eq '${PARTITION}'` }
      })) {
        list.push(entityToTicket(entity));
      }
      list.sort((a, b) => new Date(b.fechaCreacion) - new Date(a.fechaCreacion));
      context.res = { status: 200, headers: CORS, body: JSON.stringify(list) };

    } else if (req.method === "POST") {
      const body = req.body || {};
      if (!body.titulo) {
        context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: "El campo 'titulo' es obligatorio." }) };
        return;
      }
      const now    = new Date().toISOString();
      const rowKey = "TKT-" + Date.now() + "-" + Math.random().toString(36).substr(2, 4).toUpperCase();
      const entity = {
        partitionKey:       PARTITION,
        rowKey,
        titulo:             body.titulo        || "",
        descripcion:        body.descripcion   || "",
        categoria:          body.categoria     || "Otro",
        prioridad:          body.prioridad     || "Media",
        estado:             "Abierto",
        solicitante:        body.solicitante   || "",
        email:              body.email         || "",
        extension:          body.extension     || "",
        departamento:       body.departamento  || "",
        asignado:           "",
        notas:              "",
        fechaCreacion:      now,
        fechaActualizacion: now
      };
      await client.createEntity(entity);

      const ticket = entityToTicket(entity);

      // Enviar correos en paralelo esperando resultado
      await Promise.all([
        notificarNuevoTicket(ticket).catch(e => context.log("Error correo IT:", e.message)),
        confirmarAlSolicitante(ticket).catch(e => context.log("Error correo solicitante:", e.message))
      ]);

      context.res = { status: 201, headers: CORS, body: JSON.stringify(ticket) };

    } else {
      context.res = { status: 405, headers: CORS, body: JSON.stringify({ error: "Método no permitido." }) };
    }
  } catch (e) {
    context.res = { status: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
