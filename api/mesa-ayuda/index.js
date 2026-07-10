const { TableClient, AzureNamedKeyCredential } = require("@azure/data-tables");

const TABLE     = "mesaAyuda";
const PARTITION = "IT";
const CORS      = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

const ESTADOS     = ['Nuevo','En revisión','En proceso','Esperando respuesta del usuario','Resuelto','Cerrado','Cancelado'];
const CATEGORIAS  = ['Correo','Computadora','Internet/Red','Impresora/Escáner','Microsoft 365/Teams','Accesos a sistemas','Equipo nuevo','Baja de usuario','Otro'];
const PRIORIDADES = ['Baja','Media','Alta','Urgente'];
const CANALES     = ['formulario','whatsapp','teams','correo'];

function mkClient(table) {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) throw new Error("AZURE_STORAGE_CONNECTION_STRING no configurada.");
  const m1 = conn.match(/AccountName=([^;]+)/i);
  const m2 = conn.match(/AccountKey=([^;]+)/i);
  if (!m1 || !m2) throw new Error("Cadena de conexion invalida.");
  const url = `https://${m1[1]}.table.core.windows.net`;
  return new TableClient(url, table, new AzureNamedKeyCredential(m1[1], m2[1]));
}

async function nextTicketNumber() {
  const cfg = mkClient("config");
  await cfg.createTable().catch(() => {});
  let retries = 6;
  while (retries-- > 0) {
    let entity, isNew = false;
    try {
      entity = await cfg.getEntity(PARTITION, "ticket_counter");
    } catch (e) {
      if (e.statusCode === 404) { isNew = true; entity = { partitionKey: PARTITION, rowKey: "ticket_counter", valor: 0 }; }
      else throw e;
    }
    const next = (entity.valor || 0) + 1;
    const updated = { partitionKey: PARTITION, rowKey: "ticket_counter", valor: next };
    try {
      if (isNew) await cfg.createEntity(updated);
      else await cfg.updateEntity(updated, "Replace", { etag: entity.etag });
      return "IT-" + String(next).padStart(6, "0");
    } catch (e) {
      if (e.statusCode === 412) continue;
      throw e;
    }
  }
  throw new Error("No se pudo generar número de ticket");
}

function toTicket(e) {
  let historial = [], canalData = {}, adjuntos = [];
  try { historial  = e.historial  ? JSON.parse(e.historial)  : []; } catch(_) {}
  try { canalData  = e.canalData  ? JSON.parse(e.canalData)  : {}; } catch(_) {}
  try { adjuntos   = e.adjuntos   ? JSON.parse(e.adjuntos)   : []; } catch(_) {}
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

module.exports = async function (context, req) {
  try {
    const client = mkClient(TABLE);
    await client.createTable().catch(() => {});

    if (req.method === "GET") {
      const list = [];
      for await (const e of client.listEntities()) list.push(toTicket(e));
      list.sort((a, b) => new Date(b.fechaCreacion) - new Date(a.fechaCreacion));
      context.res = { status: 200, headers: CORS, body: JSON.stringify(list) };

    } else if (req.method === "POST") {
      const b = req.body || {};
      if (!b.descripcion && !b.titulo) {
        context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: "El campo 'descripcion' es obligatorio." }) };
        return;
      }
      const now    = new Date().toISOString();
      const rowKey = await nextTicketNumber();
      const canal  = CANALES.includes(b.canal) ? b.canal : "formulario";
      const historialInicial = [{
        tipo: "entrada", canal,
        autor: b.solicitante || "Anónimo",
        mensaje: b.descripcion || b.titulo || "",
        fecha: now
      }];
      const entity = {
        partitionKey: PARTITION, rowKey, canal,
        titulo:      b.titulo      || (b.descripcion || "").substring(0, 80),
        descripcion: b.descripcion || "",
        categoria:   CATEGORIAS.includes(b.categoria)  ? b.categoria  : "Otro",
        prioridad:   PRIORIDADES.includes(b.prioridad) ? b.prioridad  : "Media",
        estado:      "Nuevo",
        solicitante: b.solicitante || "", area: b.area || "", correo: b.correo || "", telefono: b.telefono || "",
        tecnicoAsignado: "",
        historial:   JSON.stringify(historialInicial),
        adjuntos:    JSON.stringify(b.adjuntos || []),
        canalData:   JSON.stringify(b.canalData || {}),
        usuarioInventarioId: b.usuarioInventarioId || "", equipoId: b.equipoId || "",
        fechaCreacion: now, fechaActualizacion: now, fechaCierre: ""
      };
      await client.createEntity(entity);
      const ticket = toTicket(entity);

      const mailer = require("../mailer");
      await Promise.all([
        mailer.notificarTicketMA   ? mailer.notificarTicketMA(ticket).catch(() => {}) : Promise.resolve(),
        mailer.confirmarTicketMA   ? mailer.confirmarTicketMA(ticket).catch(() => {}) : Promise.resolve()
      ]);

      context.res = { status: 201, headers: CORS, body: JSON.stringify(ticket) };
    } else {
      context.res = { status: 405, headers: CORS, body: JSON.stringify({ error: "Método no permitido." }) };
    }
  } catch (e) {
    context.res = { status: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
