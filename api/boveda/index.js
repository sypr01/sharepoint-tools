const { TableClient, AzureNamedKeyCredential } = require("@azure/data-tables");
const { verifyToken } = require('../lib/auth');
const crypto = require('crypto');

const TABLE       = "boveda";
const AUDIT_TABLE = "bovedaAudit";
const PARTITION   = "IT";

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-PLG-Auth"
};

function getClient(table) {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) throw new Error("AZURE_STORAGE_CONNECTION_STRING no configurada.");
  const m1 = conn.match(/AccountName=([^;]+)/i);
  const m2 = conn.match(/AccountKey=([^;]+)/i);
  if (!m1 || !m2) throw new Error("Cadena de conexion invalida.");
  const url = `https://${m1[1]}.table.core.windows.net`;
  return new TableClient(url, table, new AzureNamedKeyCredential(m1[1], m2[1]));
}

function getEncKey() {
  const bovSec = process.env.BOVEDA_SECRET;
  if (bovSec) {
    const key = Buffer.from(bovSec, 'base64');
    if (key.length === 32) return key;
  }
  // Derivar desde JWT_SECRET si BOVEDA_SECRET no está configurada
  const jwtSec = process.env.JWT_SECRET || 'plg-portal-secret-2026';
  return crypto.scryptSync(jwtSec, 'PLG-BOVEDA-SALT-2026', 32);
}

function encrypt(text) {
  const key = getEncKey();
  const iv  = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return iv.toString('base64') + ':' + tag.toString('base64') + ':' + enc.toString('base64');
}

function canRead(rol)   { return ['admin','it_admin','it_soporte','it_lectura'].includes(rol); }
function canWrite(rol)  { return ['admin','it_admin','it_soporte'].includes(rol); }
function canDelete(rol) { return ['admin','it_admin'].includes(rol); }

function toItem(e) {
  return {
    id:                 e.rowKey,
    nombre:             e.nombre             || "",
    categoria:          e.categoria          || "",
    url:                e.url                || "",
    usuario:            e.usuario            || "",
    tienePass:          !!(e.passEnc),
    notas:              e.notas              || "",
    division:           e.division           || "",
    creadoPor:          e.creadoPor          || "",
    fechaActualizacion: e.fechaActualizacion || ""
  };
}

async function logAudit(auditClient, data) {
  try {
    const rowKey = Date.now().toString() + '-' + Math.random().toString(36).slice(2, 6);
    await auditClient.createEntity({
      partitionKey: PARTITION, rowKey,
      accion:        data.accion        || "",
      sistemaId:     data.sistemaId     || "",
      sistemaNombre: data.sistemaNombre || "",
      usuarioId:     String(data.usuarioId || ""),
      usuarioNombre: data.usuarioNombre || "",
      fecha:         new Date().toISOString()
    });
  } catch (_) {}
}

module.exports = async function (context, req) {
  if (req.method === "OPTIONS") {
    context.res = { status: 200, headers: CORS, body: "" };
    return;
  }

  const user = verifyToken(req);
  if (!user || !canRead(user.rol)) {
    context.res = { status: 403, headers: CORS, body: JSON.stringify({ error: "Sin autorización." }) };
    return;
  }

  try {
    const client      = getClient(TABLE);
    const auditClient = getClient(AUDIT_TABLE);
    await client.createTable().catch(() => {});
    await auditClient.createTable().catch(() => {});

    if (req.method === "GET") {
      const items = [];
      for await (const e of client.listEntities()) {
        if (e.activo === false) continue;
        items.push(toItem(e));
      }
      items.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
      context.res = { status: 200, headers: CORS, body: JSON.stringify(items) };

    } else if (req.method === "POST") {
      if (!canWrite(user.rol)) {
        context.res = { status: 403, headers: CORS, body: JSON.stringify({ error: "Sin permisos para crear." }) };
        return;
      }
      const b = req.body || {};
      if (!b.nombre) {
        context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: "El nombre es obligatorio." }) };
        return;
      }
      const rowKey = "SIS-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
      const now    = new Date().toISOString();
      const entity = {
        partitionKey: PARTITION, rowKey,
        nombre:    b.nombre    || "",
        categoria: b.categoria || "",
        url:       b.url       || "",
        usuario:   b.usuario   || "",
        passEnc:   b.pass ? encrypt(b.pass) : "",
        notas:     b.notas     || "",
        division:  b.division  || "",
        creadoPor: user.nombre || user.usuario || "",
        activo:    true,
        fechaActualizacion: now
      };
      await client.createEntity(entity);
      await logAudit(auditClient, {
        accion: 'CREAR', sistemaId: rowKey, sistemaNombre: b.nombre,
        usuarioId: user.id, usuarioNombre: user.nombre
      });
      context.res = { status: 201, headers: CORS, body: JSON.stringify(toItem(entity)) };

    } else if (req.method === "PUT") {
      if (!canWrite(user.rol)) {
        context.res = { status: 403, headers: CORS, body: JSON.stringify({ error: "Sin permisos para editar." }) };
        return;
      }
      const id = req.query.id;
      if (!id) {
        context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: "ID requerido." }) };
        return;
      }
      const b        = req.body || {};
      const existing = await client.getEntity(PARTITION, id);
      const passEnc  = b.pass       ? encrypt(b.pass)
                     : b.clearPass  ? ""
                     : (existing.passEnc || "");
      const entity = {
        partitionKey: PARTITION, rowKey: id,
        nombre:    b.nombre    ?? existing.nombre    ?? "",
        categoria: b.categoria ?? existing.categoria ?? "",
        url:       b.url       ?? existing.url       ?? "",
        usuario:   b.usuario   ?? existing.usuario   ?? "",
        passEnc,
        notas:     b.notas     ?? existing.notas     ?? "",
        division:  b.division  ?? existing.division  ?? "",
        creadoPor: existing.creadoPor || "",
        activo:    true,
        fechaActualizacion: new Date().toISOString()
      };
      await client.updateEntity(entity, "Replace");
      await logAudit(auditClient, {
        accion: 'EDITAR', sistemaId: id, sistemaNombre: entity.nombre,
        usuarioId: user.id, usuarioNombre: user.nombre
      });
      context.res = { status: 200, headers: CORS, body: JSON.stringify(toItem(entity)) };

    } else if (req.method === "DELETE") {
      if (!canDelete(user.rol)) {
        context.res = { status: 403, headers: CORS, body: JSON.stringify({ error: "Solo administradores pueden eliminar." }) };
        return;
      }
      const id = req.query.id;
      if (!id) {
        context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: "ID requerido." }) };
        return;
      }
      const existing = await client.getEntity(PARTITION, id);
      await client.updateEntity({ partitionKey: PARTITION, rowKey: id, activo: false, fechaActualizacion: new Date().toISOString() }, "Merge");
      await logAudit(auditClient, {
        accion: 'ELIMINAR', sistemaId: id, sistemaNombre: existing.nombre || id,
        usuarioId: user.id, usuarioNombre: user.nombre
      });
      context.res = { status: 200, headers: CORS, body: JSON.stringify({ ok: true }) };

    } else {
      context.res = { status: 405, headers: CORS, body: JSON.stringify({ error: "Método no permitido." }) };
    }
  } catch (e) {
    context.res = { status: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
