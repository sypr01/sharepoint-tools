const { TableClient, AzureNamedKeyCredential } = require("@azure/data-tables");

const TABLE     = "usuarios";
const PARTITION = "IT";

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*"
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

function toUser(e) {
  return {
    id:              e.rowKey,
    nombre:          e.nombre          || "",
    division:        e.division        || "",
    area:            e.area            || "",
    puesto:          e.puesto          || "",
    telefono:        e.telefono        || "",
    celular:         e.celular         || "",
    extension:       e.extension       || "",
    hostname:        e.hostname        || "",
    anydesk:         e.anydesk         || "",
    microsoftEmail:  e.microsoftEmail  || "",
    microsoftPass:   e.microsoftPass   || "",
    gmailEmail:      e.gmailEmail      || "",
    gmailPass:       e.gmailPass       || "",
    magayaUser:      e.magayaUser      || "",
    magayaPass:      e.magayaPass      || "",
    equipos:         (function(){ try { return e.equipos ? JSON.parse(e.equipos) : []; } catch(x){ return []; } })(),
    cuentas:         (function(){ try { return e.cuentas ? JSON.parse(e.cuentas) : []; } catch(x){ return []; } })(),
    accesosFisicos:  (function(){ try { return e.accesosFisicos ? JSON.parse(e.accesosFisicos) : null; } catch(x){ return null; } })(),
    laptopModelo:    e.laptopModelo    || "",
    laptopSerie:     e.laptopSerie     || "",
    monitorModelo:   e.monitorModelo   || "",
    monitorSerie:    e.monitorSerie    || "",
    celularModelo:   e.celularModelo   || "",
    celularImei:     e.celularImei     || "",
    tabletModelo:    e.tabletModelo    || "",
    tabletImei:      e.tabletImei      || "",
    fechaActualizacion: e.fechaActualizacion || ""
  };
}

module.exports = async function (context, req) {
  try {
    const client = getClient();
    await client.createTable().catch(() => {});

    if (req.method === "GET") {
      const list = [];
      for await (const e of client.listEntities()) list.push(toUser(e));
      list.sort((a, b) => a.nombre.localeCompare(b.nombre));
      context.res = { status: 200, headers: CORS, body: JSON.stringify(list) };

    } else if (req.method === "POST") {
      const b = req.body || {};
      if (!b.nombre) {
        context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: "El campo 'nombre' es obligatorio." }) };
        return;
      }
      const now    = new Date().toISOString();
      const rowKey = "USR-" + Date.now() + "-" + Math.random().toString(36).substr(2, 4).toUpperCase();
      const entity = { partitionKey: PARTITION, rowKey, ...b,
        equipos: Array.isArray(b.equipos) ? JSON.stringify(b.equipos) : (b.equipos || ''),
        cuentas: Array.isArray(b.cuentas) ? JSON.stringify(b.cuentas) : (b.cuentas || ''),
        accesosFisicos: b.accesosFisicos && typeof b.accesosFisicos==='object' ? JSON.stringify(b.accesosFisicos) : (b.accesosFisicos || ''),
        fechaActualizacion: now };
      await client.createEntity(entity);
      context.res = { status: 201, headers: CORS, body: JSON.stringify(toUser(entity)) };

    } else if (req.method === "PUT") {
      const id = req.query.id || (req.body && req.body.id);
      if (!id) {
        context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: "Se requiere el ID del usuario." }) };
        return;
      }
      const b   = req.body || {};
      const now = new Date().toISOString();
      const entity = { partitionKey: PARTITION, rowKey: id, ...b, id: undefined,
        equipos: Array.isArray(b.equipos) ? JSON.stringify(b.equipos) : (b.equipos || ''),
        cuentas: Array.isArray(b.cuentas) ? JSON.stringify(b.cuentas) : (b.cuentas || ''),
        accesosFisicos: b.accesosFisicos && typeof b.accesosFisicos==='object' ? JSON.stringify(b.accesosFisicos) : (b.accesosFisicos || ''),
        fechaActualizacion: now };
      delete entity.id;
      await client.updateEntity(entity, "Merge");
      context.res = { status: 200, headers: CORS, body: JSON.stringify(toUser({ rowKey: id, ...b, fechaActualizacion: now })) };

    } else if (req.method === "DELETE") {
      const id = req.query.id;
      if (!id) {
        context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: "Se requiere el ID." }) };
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
