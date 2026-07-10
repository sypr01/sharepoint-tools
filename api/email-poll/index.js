// Polleo de buzón soporte@plg.com.sv mediante Microsoft Graph API
// POST manual desde el dashboard IT → procesa correos no leídos

const { TableClient, AzureNamedKeyCredential } = require("@azure/data-tables");

const TABLE     = "mesaAyuda";
const PARTITION = "IT";
const MAILBOX   = process.env.SOPORTE_MAILBOX || "soporte@plg.com.sv";
const CORS      = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

function mkClient(table) {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) return null;
  const m1 = conn.match(/AccountName=([^;]+)/i);
  const m2 = conn.match(/AccountKey=([^;]+)/i);
  if (!m1 || !m2) return null;
  const url = `https://${m1[1]}.table.core.windows.net`;
  return new TableClient(url, table, new AzureNamedKeyCredential(m1[1], m2[1]));
}

async function nextTicketNumber() {
  const cfg = mkClient("config");
  if (!cfg) throw new Error("Sin conexión a storage");
  await cfg.createTable().catch(() => {});
  let retries = 6;
  while (retries-- > 0) {
    let entity, isNew = false;
    try { entity = await cfg.getEntity(PARTITION, "ticket_counter"); }
    catch (e) {
      if (e.statusCode === 404) { isNew = true; entity = { partitionKey: PARTITION, rowKey: "ticket_counter", valor: 0 }; }
      else throw e;
    }
    const next = (entity.valor || 0) + 1;
    const updated = { partitionKey: PARTITION, rowKey: "ticket_counter", valor: next };
    try {
      if (isNew) await cfg.createEntity(updated);
      else await cfg.updateEntity(updated, "Replace", { etag: entity.etag });
      return "IT-" + String(next).padStart(6, "0");
    } catch (e) { if (e.statusCode === 412) continue; throw e; }
  }
  throw new Error("No se pudo generar número de ticket");
}

async function getGraphToken() {
  const tenantId     = process.env.GRAPH_TENANT_ID;
  const clientId     = process.env.GRAPH_CLIENT_ID;
  const clientSecret = process.env.GRAPH_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) throw new Error("Variables GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET no configuradas.");

  const params = new URLSearchParams({
    grant_type:    "client_credentials",
    client_id:     clientId,
    client_secret: clientSecret,
    scope:         "https://graph.microsoft.com/.default"
  });
  const res  = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString()
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("No se obtuvo token de Graph: " + JSON.stringify(data));
  return data.access_token;
}

async function getUnreadEmails(token) {
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAILBOX)}/messages` +
    `?$filter=isRead eq false` +
    `&$orderby=receivedDateTime asc` +
    `&$top=25` +
    `&$select=id,subject,from,body,receivedDateTime,hasAttachments`;
  const res  = await fetch(url, { headers: { "Authorization": `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) throw new Error("Graph error: " + JSON.stringify(data));
  return data.value || [];
}

async function marcarLeido(token, msgId) {
  await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAILBOX)}/messages/${msgId}`,
    {
      method: "PATCH",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ isRead: true })
    }
  );
}

function stripHtml(html) {
  return (html || "").replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim().substring(0, 2000);
}

module.exports = async function (context, req) {
  if (req.method !== "POST") {
    context.res = { status: 405, headers: CORS, body: JSON.stringify({ error: "Método no permitido." }) };
    return;
  }

  try {
    const token   = await getGraphToken();
    const emails  = await getUnreadEmails(token);
    const client  = mkClient(TABLE);
    if (!client) throw new Error("Sin conexión a storage");
    await client.createTable().catch(() => {});

    const creados = [];
    for (const email of emails) {
      try {
        const remitente = (email.from || {}).emailAddress || {};
        const nombre    = remitente.name || remitente.address || "Desconocido";
        const correo    = remitente.address || "";
        const asunto    = email.subject || "(sin asunto)";
        const cuerpo    = stripHtml((email.body || {}).content || "");
        const fecha     = email.receivedDateTime || new Date().toISOString();

        const rowKey    = await nextTicketNumber();
        const canalData = { emailMessageId: email.id, emailFrom: correo };
        const historial = [{ tipo: "entrada", canal: "correo", autor: nombre, mensaje: `Asunto: ${asunto}\n\n${cuerpo}`, fecha }];

        await client.createEntity({
          partitionKey: PARTITION, rowKey, canal: "correo",
          titulo:      asunto.substring(0, 80),
          descripcion: cuerpo,
          categoria: "Otro", prioridad: "Media", estado: "Nuevo",
          solicitante: nombre, area: "", correo, telefono: "",
          tecnicoAsignado: "",
          historial:   JSON.stringify(historial),
          adjuntos: email.hasAttachments ? JSON.stringify([{ nota: "Ver correo original para adjuntos" }]) : "[]",
          canalData:   JSON.stringify(canalData),
          usuarioInventarioId: "", equipoId: "",
          fechaCreacion: fecha, fechaActualizacion: fecha, fechaCierre: ""
        });

        const mailer = require("../mailer");
        const ticket = { id: rowKey, canal: "correo", titulo: asunto.substring(0, 80), solicitante: nombre, correo, categoria: "Otro", prioridad: "Media", estado: "Nuevo" };
        if (mailer.notificarTicketMA) mailer.notificarTicketMA(ticket).catch(() => {});

        await marcarLeido(token, email.id);
        creados.push(rowKey);
      } catch (err) {
        context.log("Error procesando correo:", err.message);
      }
    }

    context.res = {
      status: 200, headers: CORS,
      body: JSON.stringify({ revisados: emails.length, creados: creados.length, tickets: creados })
    };
  } catch (e) {
    context.res = { status: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
