// Teams Outgoing Webhook
// El usuario escribe @SoporteIT <mensaje> en un canal de Teams
// Teams envía POST a este endpoint con firma HMAC

const { TableClient, AzureNamedKeyCredential } = require("@azure/data-tables");
const crypto = require("crypto");

const TABLE     = "mesaAyuda";
const PARTITION = "IT";

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

function verificarFirmaTeams(req, secret) {
  if (!secret) return true; // sin secreto configurado, skip (solo para desarrollo)
  const authHeader = req.headers["authorization"] || "";
  if (!authHeader.startsWith("HMAC ")) return false;
  const hmacRecibido = authHeader.slice(5);
  const bodyStr      = typeof req.rawBody === "string" ? req.rawBody : JSON.stringify(req.body || {});
  const keyBuf       = Buffer.from(secret, "base64");
  const hmacCalc     = crypto.createHmac("sha256", keyBuf).update(Buffer.from(bodyStr)).digest("base64");
  return hmacRecibido === hmacCalc;
}

function limpiarMencionTeams(texto) {
  // Eliminar tags <at>…</at> y texto HTML básico
  return (texto || "")
    .replace(/<at>[^<]*<\/at>/gi, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

module.exports = async function (context, req) {
  const CORS = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

  // Verificar firma HMAC de Teams
  const secret = process.env.TEAMS_HMAC_SECRET;
  if (!verificarFirmaTeams(req, secret)) {
    context.res = { status: 401, headers: CORS, body: JSON.stringify({ error: "Firma inválida." }) };
    return;
  }

  try {
    const b    = req.body || {};
    const tipo = b.type || "";

    // Teams envía ping de verificación
    if (tipo === "invoke" || !b.text) {
      context.res = { status: 200, headers: CORS, body: JSON.stringify({ type: "message", text: "🤖 PLG IT SoporteBot listo." }) };
      return;
    }

    const texto         = limpiarMencionTeams(b.text);
    const nombre        = (b.from || {}).name || "Desconocido";
    const teamsUserId   = (b.from || {}).id    || "";
    const channelId     = ((b.channelData || {}).channel || {}).id || "";
    const now           = new Date().toISOString();

    const client = mkClient(TABLE);
    if (!client) {
      context.res = { status: 200, headers: CORS, body: JSON.stringify({ type: "message", text: "❌ Error interno. Contacta a soporte@plg.com.sv directamente." }) };
      return;
    }
    await client.createTable().catch(() => {});

    const rowKey    = await nextTicketNumber();
    const canalData = { teamsUserId, channelId, teamsConversationId: (b.conversation || {}).id || "" };
    const historial = [{ tipo: "entrada", canal: "teams", autor: nombre, mensaje: texto, fecha: now }];

    await client.createEntity({
      partitionKey: PARTITION, rowKey, canal: "teams",
      titulo:      texto.substring(0, 80),
      descripcion: texto,
      categoria: "Otro", prioridad: "Media", estado: "Nuevo",
      solicitante: nombre, area: "", correo: "", telefono: "",
      tecnicoAsignado: "",
      historial:   JSON.stringify(historial),
      adjuntos: "[]", canalData: JSON.stringify(canalData),
      usuarioInventarioId: "", equipoId: "",
      fechaCreacion: now, fechaActualizacion: now, fechaCierre: ""
    });

    const mailer = require("../mailer");
    const ticket = { id: rowKey, canal: "teams", titulo: texto.substring(0, 80), solicitante: nombre, categoria: "Otro", prioridad: "Media", estado: "Nuevo" };
    if (mailer.notificarTicketMA) mailer.notificarTicketMA(ticket).catch(() => {});

    context.res = {
      status: 200, headers: CORS,
      body: JSON.stringify({
        type: "message",
        text: `✅ Ticket **${rowKey}** creado. El equipo de IT atenderá tu solicitud lo antes posible.\n\n_Puedes agregar más detalles respondiendo en este hilo._`
      })
    };
  } catch (e) {
    context.log("Error teams-hook:", e.message);
    context.res = {
      status: 200, headers: CORS,
      body: JSON.stringify({ type: "message", text: "❌ No se pudo crear el ticket. Intenta de nuevo o escribe a soporte@plg.com.sv" })
    };
  }
};
