const { TableClient, AzureNamedKeyCredential } = require("@azure/data-tables");

const TABLE     = "mesaAyuda";
const PARTITION = "IT";
const CORS      = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

const ESTADOS_CIERRE = ["Resuelto", "Cerrado", "Cancelado"];

function mkClient() {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) throw new Error("AZURE_STORAGE_CONNECTION_STRING no configurada.");
  const m1 = conn.match(/AccountName=([^;]+)/i);
  const m2 = conn.match(/AccountKey=([^;]+)/i);
  if (!m1 || !m2) throw new Error("Cadena de conexion invalida.");
  const url = `https://${m1[1]}.table.core.windows.net`;
  return new TableClient(url, TABLE, new AzureNamedKeyCredential(m1[1], m2[1]));
}

function toTicket(e) {
  let historial = [], canalData = {}, adjuntos = [];
  try { historial = e.historial ? JSON.parse(e.historial) : []; } catch(_) {}
  try { canalData = e.canalData ? JSON.parse(e.canalData) : {}; } catch(_) {}
  try { adjuntos  = e.adjuntos  ? JSON.parse(e.adjuntos)  : []; } catch(_) {}
  return {
    id: e.rowKey, canal: e.canal || "formulario",
    titulo: e.titulo || "", descripcion: e.descripcion || "",
    categoria: e.categoria || "Otro", prioridad: e.prioridad || "Media", estado: e.estado || "Nuevo",
    solicitante: e.solicitante || "", area: e.area || "", correo: e.correo || "", telefono: e.telefono || "",
    tecnicoAsignado: e.tecnicoAsignado || "", historial, adjuntos, canalData,
    usuarioInventarioId: e.usuarioInventarioId || "", equipoId: e.equipoId || "",
    fechaCreacion: e.fechaCreacion || "", fechaActualizacion: e.fechaActualizacion || "", fechaCierre: e.fechaCierre || ""
  };
}

async function enviarWhatsApp(phone, texto) {
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const token   = process.env.WHATSAPP_TOKEN;
  if (!phoneId || !token || !phone) return;
  await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: phone, type: "text", text: { body: texto } })
  });
}

async function notificarTeamsReply(ticket, mensaje, autor) {
  const hookUrl = process.env.TEAMS_INCOMING_WEBHOOK_URL;
  if (!hookUrl) return;
  const card = {
    "@type": "MessageCard", "@context": "http://schema.org/extensions",
    "summary": `Respuesta IT al ticket ${ticket.id}`,
    "themeColor": "1B3A6B",
    "sections": [{
      "activityTitle": `Respuesta al ticket ${ticket.id}`,
      "activitySubtitle": `Técnico: ${autor}`,
      "activityText": mensaje,
      "facts": [
        { "name": "Ticket", "value": ticket.id },
        { "name": "Solicitante", "value": ticket.solicitante },
        { "name": "Estado", "value": ticket.estado }
      ]
    }]
  };
  await fetch(hookUrl, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(card)
  }).catch(() => {});
}

module.exports = async function (context, req) {
  const id = context.bindingData.id;
  if (!id) {
    context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: "ID de ticket requerido." }) };
    return;
  }

  try {
    const client = mkClient();

    // ── GET ──────────────────────────────────────────────────────────
    if (req.method === "GET") {
      const entity = await client.getEntity(PARTITION, id);
      context.res = { status: 200, headers: CORS, body: JSON.stringify(toTicket(entity)) };

    // ── PUT — actualizar campos del ticket ───────────────────────────
    } else if (req.method === "PUT") {
      const b        = req.body || {};
      const now      = new Date().toISOString();
      const existing = await client.getEntity(PARTITION, id);
      let historial  = [];
      try { historial = existing.historial ? JSON.parse(existing.historial) : []; } catch(_) {}

      const estadoAnterior = existing.estado;
      const nuevoEstado    = b.estado !== undefined ? b.estado : existing.estado;

      // Registrar cambio de estado en historial
      if (b.estado && b.estado !== estadoAnterior) {
        historial.push({ tipo: "cambio_estado", autor: b.autorCambio || "IT", anterior: estadoAnterior, nuevo: b.estado, fecha: now });
      }
      // Registrar asignación de técnico
      if (b.tecnicoAsignado !== undefined && b.tecnicoAsignado !== existing.tecnicoAsignado) {
        historial.push({ tipo: "asignacion", autor: b.autorCambio || "IT", mensaje: `Asignado a: ${b.tecnicoAsignado || "(sin asignar)"}`, fecha: now });
      }

      const fechaCierre = ESTADOS_CIERRE.includes(nuevoEstado) ? (existing.fechaCierre || now) : "";

      const patch = {
        partitionKey: PARTITION, rowKey: id,
        estado:               nuevoEstado,
        prioridad:            b.prioridad            !== undefined ? b.prioridad            : existing.prioridad,
        tecnicoAsignado:      b.tecnicoAsignado      !== undefined ? b.tecnicoAsignado      : existing.tecnicoAsignado,
        usuarioInventarioId:  b.usuarioInventarioId  !== undefined ? b.usuarioInventarioId  : existing.usuarioInventarioId,
        equipoId:             b.equipoId             !== undefined ? b.equipoId             : existing.equipoId,
        historial:            JSON.stringify(historial),
        fechaActualizacion:   now,
        fechaCierre
      };
      await client.updateEntity(patch, "Merge");

      const updatedEntity = await client.getEntity(PARTITION, id);
      const ticket = toTicket(updatedEntity);

      // Notificar al usuario si cambió estado o fue cerrado
      const mailer = require("../mailer");
      if (b.estado && b.estado !== estadoAnterior && ticket.correo && mailer.notificarActualizacionMA) {
        mailer.notificarActualizacionMA(ticket).catch(() => {});
      }

      context.res = { status: 200, headers: CORS, body: JSON.stringify(ticket) };

    // ── POST — agregar comentario o responder al usuario ─────────────
    } else if (req.method === "POST") {
      const b        = req.body || {};
      const accion   = b.accion || "comentario_interno";
      const now      = new Date().toISOString();
      const existing = await client.getEntity(PARTITION, id);
      let historial  = [];
      try { historial = existing.historial ? JSON.parse(existing.historial) : []; } catch(_) {}

      if (!b.mensaje) {
        context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: "El campo 'mensaje' es obligatorio." }) };
        return;
      }

      const entrada = {
        tipo:   accion,
        autor:  b.autor || "IT",
        mensaje: b.mensaje,
        fecha:  now
      };
      historial.push(entrada);

      const patch = { partitionKey: PARTITION, rowKey: id, historial: JSON.stringify(historial), fechaActualizacion: now };
      await client.updateEntity(patch, "Merge");

      const updatedEntity = await client.getEntity(PARTITION, id);
      const ticket = toTicket(updatedEntity);

      // Enviar respuesta al usuario si es tipo "responder"
      if (accion === "responder") {
        const mailer = require("../mailer");

        // Por correo (si hay correo disponible)
        if (ticket.correo && mailer.responderPorCorreo) {
          mailer.responderPorCorreo(ticket, b.mensaje, b.autor || "IT").catch(() => {});
        }
        // Por WhatsApp si el canal original fue whatsapp
        if (ticket.canal === "whatsapp" && ticket.canalData && ticket.canalData.waPhone) {
          const msg = `[PLG IT - ${ticket.id}] ${b.mensaje}`;
          enviarWhatsApp(ticket.canalData.waPhone, msg).catch(() => {});
        }
        // Por Teams si hay webhook configurado
        if (ticket.canal === "teams") {
          notificarTeamsReply(ticket, b.mensaje, b.autor || "IT").catch(() => {});
        }
      }

      context.res = { status: 200, headers: CORS, body: JSON.stringify(ticket) };

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
