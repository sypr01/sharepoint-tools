const { TableClient, AzureNamedKeyCredential } = require("@azure/data-tables");
const { verifyToken } = require('../lib/auth');
const { Pool }        = require('pg');
const bcrypt          = require('bcryptjs');
const crypto          = require('crypto');

const TABLE       = "boveda";
const AUDIT_TABLE = "bovedaAudit";
const PARTITION   = "IT";

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-PLG-Auth"
};

function getClient(table) {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const m1 = conn.match(/AccountName=([^;]+)/i);
  const m2 = conn.match(/AccountKey=([^;]+)/i);
  return new TableClient(`https://${m1[1]}.table.core.windows.net`, table, new AzureNamedKeyCredential(m1[1], m2[1]));
}

function getEncKey() {
  const bovSec = process.env.BOVEDA_SECRET;
  if (bovSec) {
    const key = Buffer.from(bovSec, 'base64');
    if (key.length === 32) return key;
  }
  const jwtSec = process.env.JWT_SECRET || 'plg-portal-secret-2026';
  return crypto.scryptSync(jwtSec, 'PLG-BOVEDA-SALT-2026', 32);
}

function decrypt(stored) {
  const key = getEncKey();
  const [ivB64, tagB64, encB64] = stored.split(':');
  const iv  = Buffer.from(ivB64,  'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const enc = Buffer.from(encB64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
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
  if (!user) {
    context.res = { status: 403, headers: CORS, body: JSON.stringify({ error: "Sin autorización." }) };
    return;
  }

  const { sistemaId, password } = req.body || {};
  if (!sistemaId || !password) {
    context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: "sistemaId y password requeridos." }) };
    return;
  }

  const auditClient = getClient(AUDIT_TABLE);
  await auditClient.createTable().catch(() => {});

  // Verificar contraseña del usuario contra Supabase
  const pool = new Pool({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
    max: 1, idleTimeoutMillis: 5000
  });

  try {
    const result = await pool.query(
      'SELECT contrasena_hash FROM usuarios_sistema WHERE id = $1 AND activo = true',
      [user.id]
    );
    const row = result.rows[0];
    if (!row) {
      context.res = { status: 401, headers: CORS, body: JSON.stringify({ error: "Usuario no encontrado." }) };
      return;
    }

    const ok = await bcrypt.compare(password, row.contrasena_hash);
    if (!ok) {
      await logAudit(auditClient, {
        accion: 'REVELAR_FALLIDO', sistemaId, sistemaNombre: '-',
        usuarioId: user.id, usuarioNombre: user.nombre
      });
      context.res = { status: 401, headers: CORS, body: JSON.stringify({ error: "Contraseña incorrecta." }) };
      return;
    }

    const client = getClient(TABLE);
    const entity = await client.getEntity(PARTITION, sistemaId);
    if (!entity || !entity.passEnc) {
      context.res = { status: 404, headers: CORS, body: JSON.stringify({ error: "Sin contraseña registrada." }) };
      return;
    }

    const pass = decrypt(entity.passEnc);
    await logAudit(auditClient, {
      accion: 'REVELAR', sistemaId, sistemaNombre: entity.nombre || sistemaId,
      usuarioId: user.id, usuarioNombre: user.nombre
    });

    context.res = { status: 200, headers: CORS, body: JSON.stringify({ pass }) };
  } catch (e) {
    context.res = { status: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  } finally {
    await pool.end().catch(() => {});
  }
};
