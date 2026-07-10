// WhatsApp Business Cloud API webhook
// GET  → verificación de webhook con hub.challenge
// POST → procesa mensajes entrantes y crea/actualiza tickets

const { TableClient, AzureNamedKeyCredential } = require("@azure/data-tables");

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

async function buscarTicketAbiertoPorTelefono(client, waPhone) {
  const ESTADOS_ABIERTOS = ["Nuevo", "En revisión", "En proceso", "Esperando respuesta del usuario"];
  for await (const e of client.listEntities({ queryOptions: { filter: `PartitionKey eq '${PARTITION}' and canal eq 'whatsapp'` } })) {
    let cd = {};
    try { cd = e.canalData ? JSON.parse(e.canalData) : {}; } catch(_) {}
    if (cd.waPhone === waPhone && ESTADOS_ABIERTOS.includes(e.estado)) return e;
  }
  return null;
}

async function enviarAckWhatsApp(to, texto) {
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const token   = process.env.WHATSAPP_TOKEN;
  if (!phoneId || !token) return;
  await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: texto } })
  }).catch(() => {});
}

module.exports = async function (context, req) {
  // ── Verificación de webhook (GET) ────────────────────────────────
  if (req.method === "GET") {
    const mode      = req.query["hub.mode"];
    const token     = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    const myToken   = process.env.WHATSAPP_VERIFY_TOKEN || "plg-whatsapp-verify";
    if (mode === "subscribe" && token === myToken) {
      context.res = { status: 200, headers: { "Content-Type": "text/plain" }, body: challenge };
    } else {
      context.res = { status: 403, body: "Forbidden" };
    }
    return;
  }

  // ── Mensaje entrante (POST) ──────────────────────────────────────
  // Meta espera 200 OK rápidamente — procesamos async
  context.res = { status: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "ok" }) };

  try {
    const body    = req.body || {};
    const entries = (body.entry || []);
    for (const entry of entries) {
      for (const change of (entry.changes || [])) {
        const val      = change.value || {};
        const messages = val.messages || [];
        const contacts = val.contacts || [];
        for (let i = 0; i < messages.length; i++) {
          const msg     = messages[i];
          if (msg.type !== "text") continue;
          const waPhone = msg.from;
          const texto   = (msg.text || {}).body || "";
          const nombre  = (contacts[i] || {}).profile ? contacts[i].profile.name : waPhone;
          const now     = new Date().toISOString();

          const client = mkClient(TABLE);
          if (!client) continue;
          await client.createTable().catch(() => {});

          // Buscar ticket abierto de este número
          const existing = await buscarTicketAbiertoPorTelefono(client, waPhone);

          if (existing) {
            // Agregar al historial del ticket existente
            let historial = [];
            try { historial = existing.historial ? JSON.parse(existing.historial) : []; } catch(_) {}
            historial.push({ tipo: "mensaje_usuario", canal: "whatsapp", autor: nombre, mensaje: texto, fecha: now });
            await client.updateEntity({
              partitionKey: PARTITION, rowKey: existing.rowKey,
              historial: JSON.stringify(historial),
              estado: existing.estado === "Esperando respuesta del usuario" ? "En proceso" : existing.estado,
              fechaActualizacion: now
            }, "Merge");
            await enviarAckWhatsApp(waPhone, `Recibimos tu mensaje y lo agregamos al ticket ${existing.rowKey}. El equipo de IT te responderá pronto.`);
          } else {
            // Crear nuevo ticket
            const rowKey = await nextTicketNumber();
            const canalData = { waPhone, waMsgId: msg.id };
            const historialInicial = [{ tipo: "entrada", canal: "whatsapp", autor: nombre, mensaje: texto, fecha: now }];
            await client.createEntity({
              partitionKey: PARTITION, rowKey, canal: "whatsapp",
              titulo:      texto.substring(0, 80),
              descripcion: texto,
              categoria:   "Otro", prioridad: "Media", estado: "Nuevo",
              solicitante: nombre, area: "", correo: "", telefono: waPhone,
              tecnicoAsignado: "",
              historial:   JSON.stringify(historialInicial),
              adjuntos:    "[]", canalData: JSON.stringify(canalData),
              usuarioInventarioId: "", equipoId: "",
              fechaCreacion: now, fechaActualizacion: now, fechaCierre: ""
            });

            const mailer = require("../mailer");
            const ticket = { id: rowKey, canal: "whatsapp", titulo: texto.substring(0, 80), solicitante: nombre, telefono: waPhone, categoria: "Otro", prioridad: "Media", estado: "Nuevo" };
            if (mailer.notificarTicketMA) mailer.notificarTicketMA(ticket).catch(() => {});

            await enviarAckWhatsApp(waPhone,
              `✅ Hola ${nombre}, tu solicitud fue registrada.\n\nTicket: *${rowKey}*\n\nEl equipo de IT te contactará pronto. Puedes responder a este número para agregar más información.`
            );
          }
        }
      }
    }
  } catch (e) {
    context.log("Error procesando webhook WhatsApp:", e.message);
  }
};
