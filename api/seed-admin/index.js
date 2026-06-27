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
  const adminUser = process.env.PORTAL_USER;
  const adminPass = process.env.PORTAL_PASS;

  if (!adminUser || !adminPass) {
    context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: "Variables PORTAL_USER y PORTAL_PASS no configuradas." }) };
    return;
  }
  if (!process.env.SUPABASE_DB_URL) {
    context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: "Variable SUPABASE_DB_URL no configurada." }) };
    return;
  }

  const pool = getPool();
  try {
    // Crear tabla si no existe
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
      context.res = { status: 409, headers: CORS, body: JSON.stringify({ error: "Ya existen usuarios. El setup inicial solo puede ejecutarse una vez." }) };
      return;
    }

    const hash = await bcrypt.hash(adminPass, 10);
    await pool.query(
      'INSERT INTO usuarios_sistema (nombre, usuario, contrasena_hash, rol) VALUES ($1, $2, $3, $4)',
      ['Administrador', adminUser.toLowerCase(), hash, 'admin']
    );

    context.res = {
      status: 200,
      headers: CORS,
      body: JSON.stringify({ ok: true, mensaje: `Usuario admin '${adminUser}' creado correctamente. Ya puedes iniciar sesión.` })
    };
  } catch (e) {
    context.res = { status: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  } finally {
    await pool.end().catch(() => {});
  }
};
