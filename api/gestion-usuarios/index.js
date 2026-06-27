const { Pool }      = require('pg');
const bcrypt         = require('bcryptjs');
const { verifyToken } = require('../lib/auth');

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

function getPool() {
  return new Pool({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
    max: 1,
    idleTimeoutMillis: 5000
  });
}

function unauthorized(context) {
  context.res = { status: 401, headers: CORS, body: JSON.stringify({ error: "No autorizado." }) };
}

module.exports = async function (context, req) {
  if (req.method === "OPTIONS") {
    context.res = { status: 200, headers: CORS, body: "" };
    return;
  }

  const payload = verifyToken(req);
  if (!payload || payload.rol !== 'admin') {
    unauthorized(context);
    return;
  }

  const pool = getPool();
  try {
    if (req.method === "GET") {
      const result = await pool.query(
        `SELECT id, nombre, usuario, rol, activo, creado_en, ultimo_acceso
         FROM usuarios_sistema ORDER BY creado_en ASC`
      );
      context.res = { status: 200, headers: CORS, body: JSON.stringify(result.rows) };

    } else if (req.method === "POST") {
      const { nombre, usuario, contrasena, rol } = req.body || {};
      if (!nombre || !usuario || !contrasena) {
        context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: "nombre, usuario y contrasena son obligatorios." }) };
        return;
      }
      const hash = await bcrypt.hash(contrasena, 10);
      const result = await pool.query(
        `INSERT INTO usuarios_sistema (nombre, usuario, contrasena_hash, rol)
         VALUES ($1, $2, $3, $4)
         RETURNING id, nombre, usuario, rol, activo, creado_en`,
        [nombre.trim(), usuario.trim().toLowerCase(), hash, rol || 'usuario']
      );
      context.res = { status: 201, headers: CORS, body: JSON.stringify(result.rows[0]) };

    } else if (req.method === "PUT") {
      const id = req.query.id;
      if (!id) {
        context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: "Se requiere el ID." }) };
        return;
      }
      const { nombre, rol, activo, contrasena } = req.body || {};
      const updates = [];
      const values  = [];
      let i = 1;
      if (nombre    !== undefined) { updates.push(`nombre = $${i++}`);          values.push(nombre.trim()); }
      if (rol       !== undefined) { updates.push(`rol = $${i++}`);             values.push(rol); }
      if (activo    !== undefined) { updates.push(`activo = $${i++}`);          values.push(activo); }
      if (contrasena) {
        const hash = await bcrypt.hash(contrasena, 10);
        updates.push(`contrasena_hash = $${i++}`);
        values.push(hash);
      }
      if (!updates.length) {
        context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: "Nada que actualizar." }) };
        return;
      }
      // No permitir desactivar al último admin
      if (activo === false || activo === 'false') {
        const admins = await pool.query(`SELECT COUNT(*) FROM usuarios_sistema WHERE rol='admin' AND activo=true AND id != $1`, [id]);
        if (parseInt(admins.rows[0].count) === 0) {
          context.res = { status: 409, headers: CORS, body: JSON.stringify({ error: "No puedes desactivar al único administrador activo." }) };
          return;
        }
      }
      values.push(id);
      const result = await pool.query(
        `UPDATE usuarios_sistema SET ${updates.join(', ')} WHERE id = $${i} RETURNING id, nombre, usuario, rol, activo`,
        values
      );
      context.res = { status: 200, headers: CORS, body: JSON.stringify(result.rows[0]) };

    } else if (req.method === "DELETE") {
      const id = req.query.id;
      if (!id) {
        context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: "Se requiere el ID." }) };
        return;
      }
      // No eliminar si es el único admin
      const target = await pool.query('SELECT rol FROM usuarios_sistema WHERE id = $1', [id]);
      if (target.rows[0] && target.rows[0].rol === 'admin') {
        const admins = await pool.query("SELECT COUNT(*) FROM usuarios_sistema WHERE rol='admin'");
        if (parseInt(admins.rows[0].count) <= 1) {
          context.res = { status: 409, headers: CORS, body: JSON.stringify({ error: "No puedes eliminar al único administrador." }) };
          return;
        }
      }
      await pool.query('DELETE FROM usuarios_sistema WHERE id = $1', [id]);
      context.res = { status: 200, headers: CORS, body: JSON.stringify({ ok: true }) };

    } else {
      context.res = { status: 405, headers: CORS, body: JSON.stringify({ error: "Método no permitido." }) };
    }
  } catch (e) {
    if (e.code === '23505') {
      context.res = { status: 409, headers: CORS, body: JSON.stringify({ error: "El nombre de usuario ya existe." }) };
    } else {
      context.res = { status: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
    }
  } finally {
    await pool.end().catch(() => {});
  }
};
