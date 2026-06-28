const { Pool } = require('pg');
const bcrypt   = require('bcryptjs');

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*"
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
  if (!process.env.SUPABASE_DB_URL) {
    context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: "Variable SUPABASE_DB_URL no configurada en Azure." }) };
    return;
  }

  const { nombre, usuario, contrasena } = req.body || {};

  if (!nombre || !usuario || !contrasena) {
    context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: "Se requieren: nombre, usuario, contrasena." }) };
    return;
  }
  if (contrasena.length < 6) {
    context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: "La contrasena debe tener al menos 6 caracteres." }) };
    return;
  }

  const pool = getPool();
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS usuarios_sistema (
        id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        nombre          VARCHAR(100) NOT NULL,
        usuario         VARCHAR(50)  UNIQUE NOT NULL,
        contrasena_hash VARCHAR(255) NOT NULL,
        rol             VARCHAR(20)  NOT NULL DEFAULT 'usuario',
        activo          BOOLEAN      NOT NULL DEFAULT true,
        creado_en       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        ultimo_acceso   TIMESTAMPTZ
      )
    `);

    const existe = await pool.query('SELECT COUNT(*) FROM usuarios_sistema');
    if (parseInt(existe.rows[0].count) > 0) {
      context.res = { status: 409, headers: CORS, body: JSON.stringify({ error: "Ya existen usuarios registrados. El setup inicial no puede ejecutarse de nuevo." }) };
      return;
    }

    const hash = await bcrypt.hash(contrasena, 10);
    await pool.query(
      'INSERT INTO usuarios_sistema (nombre, usuario, contrasena_hash, rol) VALUES ($1, $2, $3, $4)',
      [nombre.trim(), usuario.trim().toLowerCase(), hash, 'admin']
    );

    context.res = {
      status: 200,
      headers: CORS,
      body: JSON.stringify({ ok: true, mensaje: `Admin '${usuario.toLowerCase()}' creado. Ya puedes iniciar sesion en /login.html` })
    };
  } catch (e) {
    if (e.code === '23505') {
      context.res = { status: 409, headers: CORS, body: JSON.stringify({ error: "Ese nombre de usuario ya existe." }) };
    } else {
      context.res = { status: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
    }
  } finally {
    await pool.end().catch(() => {});
  }
};
