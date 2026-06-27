const { Pool }    = require('pg');
const bcrypt       = require('bcryptjs');
const { signToken } = require('../lib/auth');

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function getPool() {
  return new Pool({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
    max: 1,
    idleTimeoutMillis: 5000
  });
}

module.exports = async function (context, req) {
  if (req.method === "OPTIONS") {
    context.res = { status: 200, headers: CORS, body: "" };
    return;
  }

  const { usuario, contrasena } = req.body || {};
  if (!usuario || !contrasena) {
    context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: "Usuario y contraseña requeridos." }) };
    return;
  }

  const pool = getPool();
  try {
    const result = await pool.query(
      'SELECT id, nombre, usuario, contrasena_hash, rol, activo FROM usuarios_sistema WHERE usuario = $1',
      [usuario.trim().toLowerCase()]
    );

    const user = result.rows[0];
    if (!user || !user.activo) {
      context.res = { status: 401, headers: CORS, body: JSON.stringify({ error: "Credenciales incorrectas." }) };
      return;
    }

    const ok = await bcrypt.compare(contrasena, user.contrasena_hash);
    if (!ok) {
      context.res = { status: 401, headers: CORS, body: JSON.stringify({ error: "Credenciales incorrectas." }) };
      return;
    }

    await pool.query('UPDATE usuarios_sistema SET ultimo_acceso = NOW() WHERE id = $1', [user.id]);

    const token = signToken({ id: user.id, nombre: user.nombre, usuario: user.usuario, rol: user.rol });
    context.res = {
      status: 200,
      headers: CORS,
      body: JSON.stringify({ ok: true, token, nombre: user.nombre, rol: user.rol })
    };
  } catch (e) {
    context.res = { status: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  } finally {
    await pool.end().catch(() => {});
  }
};
