const nodemailer = require("nodemailer");

const IT_EMAIL = process.env.IT_EMAIL   || "soporte@plg.com.sv";
const FROM     = process.env.SMTP_USER  || "soporte@plg.com.sv";

function crearTransporte() {
  return nodemailer.createTransport({
    host:   "smtp.office365.com",
    port:   587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    tls: { rejectUnauthorized: false }
  });
}

function colorPrioridad(p) {
  return { Urgente: "#CC1F2A", Alta: "#f59e0b", Media: "#2F5AA8", Baja: "#10b981" }[p] || "#666";
}
function colorEstado(e) {
  return { Abierto: "#2F5AA8", "En Proceso": "#f59e0b", Resuelto: "#10b981", Cerrado: "#666" }[e] || "#666";
}

function plantillaBase(contenido) {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F0F4F9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F0F4F9;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#1B3A6B,#2F5AA8);padding:24px 32px;border-bottom:4px solid #CC1F2A;">
            <div style="font-size:20px;font-weight:800;color:white;">PLG &middot; Soporte de TI</div>
            <div style="font-size:12px;color:rgba(255,255,255,0.7);margin-top:3px;">PANAMERICAN LOGISTICS GROUP</div>
          </td>
        </tr>
        <tr><td style="padding:32px;">${contenido}</td></tr>
        <tr>
          <td style="background:#F0F4F9;padding:16px 32px;border-top:1px solid #dde3ed;text-align:center;">
            <p style="margin:0;font-size:11px;color:#999;">Sistema de Tickets IT &middot; PANAMERICAN LOGISTICS GROUP</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function filaDato(label, valor) {
  return `<tr>
    <td style="padding:8px 12px;font-size:12px;font-weight:700;color:#778;text-transform:uppercase;background:#F8FAFC;width:140px;">${label}</td>
    <td style="padding:8px 12px;font-size:14px;color:#333;">${valor || "-"}</td>
  </tr>`;
}

// ── Nuevo ticket → IT ─────────────────────────────────────────────
async function notificarNuevoTicket(ticket) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return;
  const t = crearTransporte();
  const cuerpo = `
    <h2 style="color:#1B3A6B;margin:0 0 8px;">Nuevo ticket recibido</h2>
    <p style="color:#666;font-size:14px;margin:0 0 20px;">ID: <strong>${ticket.id}</strong></p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #edf0f5;border-radius:8px;overflow:hidden;margin-bottom:20px;">
      ${filaDato("Titulo", ticket.titulo)}
      ${filaDato("Categoria", ticket.categoria)}
      ${filaDato("Prioridad", ticket.prioridad)}
      ${filaDato("Solicitante", ticket.solicitante)}
      ${filaDato("Correo", ticket.email)}
      ${filaDato("Telefono", ticket.extension)}
      ${filaDato("Departamento", ticket.departamento)}
    </table>
    <div style="background:#F0F4F9;border-radius:8px;padding:16px;margin-bottom:16px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#778;">DESCRIPCION</p>
      <p style="margin:0;font-size:14px;color:#444;">${ticket.descripcion}</p>
    </div>`;
  await t.sendMail({
    from: `"Soporte IT PLG" <${FROM}>`,
    to: IT_EMAIL,
    subject: `[${ticket.prioridad.toUpperCase()}] Nuevo Ticket: ${ticket.titulo} - ${ticket.id}`,
    html: plantillaBase(cuerpo)
  });
}

// ── Confirmación → solicitante ────────────────────────────────────
async function confirmarAlSolicitante(ticket) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS || !ticket.email) return;
  const t = crearTransporte();
  const cuerpo = `
    <h2 style="color:#1B3A6B;margin:0 0 8px;">Tu ticket fue recibido</h2>
    <p style="color:#666;font-size:14px;margin:0 0 20px;">Hola <strong>${ticket.solicitante}</strong>, el equipo de TI atenderd tu solicitud.</p>
    <div style="background:#d1fae5;border:1px solid #6ee7b7;border-radius:8px;padding:12px;margin-bottom:20px;text-align:center;">
      <strong style="color:#065f46;font-size:16px;">Numero de ticket: ${ticket.id}</strong>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #edf0f5;border-radius:8px;overflow:hidden;">
      ${filaDato("Problema", ticket.titulo)}
      ${filaDato("Categoria", ticket.categoria)}
      ${filaDato("Prioridad", ticket.prioridad)}
      ${filaDato("Estado", "Abierto")}
    </table>`;
  await t.sendMail({
    from: `"Soporte IT PLG" <${FROM}>`,
    to: ticket.email,
    subject: `Ticket recibido: ${ticket.id} - ${ticket.titulo}`,
    html: plantillaBase(cuerpo)
  });
}

// ── Actualizacion → solicitante ───────────────────────────────────
async function notificarActualizacion(ticket) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS || !ticket.email) return;
  const t = crearTransporte();
  const esResuelto = ticket.estado === "Resuelto" || ticket.estado === "Cerrado";
  const cuerpo = `
    <h2 style="color:#1B3A6B;margin:0 0 8px;">Tu ticket fue actualizado</h2>
    <p style="color:#666;font-size:14px;margin:0 0 20px;">Hola <strong>${ticket.solicitante}</strong>.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #edf0f5;border-radius:8px;overflow:hidden;margin-bottom:20px;">
      ${filaDato("Ticket", ticket.id)}
      ${filaDato("Problema", ticket.titulo)}
      ${filaDato("Nuevo estado", ticket.estado)}
      ${ticket.asignado ? filaDato("Tecnico", ticket.asignado) : ""}
    </table>
    ${ticket.notas ? `<div style="background:#F0F4F9;border-radius:8px;padding:16px;margin-bottom:16px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#778;">${esResuelto ? "SOLUCION" : "NOTAS"}</p>
      <p style="margin:0;font-size:14px;color:#444;">${ticket.notas}</p>
    </div>` : ""}
    ${esResuelto ? `<div style="background:#d1fae5;border-radius:8px;padding:12px;text-align:center;">
      <strong style="color:#065f46;">Tu problema ha sido resuelto. Si persiste, abre un nuevo ticket.</strong>
    </div>` : ""}`;
  await t.sendMail({
    from: `"Soporte IT PLG" <${FROM}>`,
    to: ticket.email,
    subject: `Ticket ${ticket.id} actualizado: ${ticket.estado}`,
    html: plantillaBase(cuerpo)
  });
}

// ── Mesa de Ayuda IT — Nuevo ticket (notif IT) ────────────────────
const CANAL_LABEL = { formulario: '🌐 Formulario web', whatsapp: '💬 WhatsApp', teams: '👥 Microsoft Teams', correo: '📧 Correo electrónico' };

async function notificarTicketMA(ticket) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return;
  const t = crearTransporte();
  const canal = CANAL_LABEL[ticket.canal] || ticket.canal || 'Formulario';
  const cuerpo = `
    <h2 style="color:#1B3A6B;margin:0 0 8px;">Nuevo ticket — ${canal}</h2>
    <p style="color:#666;font-size:14px;margin:0 0 20px;">Número: <strong>${ticket.id}</strong></p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #edf0f5;border-radius:8px;overflow:hidden;margin-bottom:20px;">
      ${filaDato('Asunto', ticket.titulo)}
      ${filaDato('Categoría', ticket.categoria)}
      ${filaDato('Prioridad', `<span style="color:${colorPrioridad(ticket.prioridad)};font-weight:700">${ticket.prioridad}</span>`)}
      ${filaDato('Solicitante', ticket.solicitante)}
      ${filaDato('Área', ticket.area || '-')}
      ${filaDato('Correo', ticket.correo || '-')}
      ${filaDato('Teléfono', ticket.telefono || '-')}
      ${filaDato('Canal', canal)}
    </table>
    <div style="background:#F0F4F9;border-radius:8px;padding:16px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#778;">DESCRIPCIÓN</p>
      <p style="margin:0;font-size:14px;color:#444;white-space:pre-wrap">${ticket.descripcion || ticket.titulo || ''}</p>
    </div>`;
  await t.sendMail({
    from: `"Soporte IT PLG" <${FROM}>`,
    to: IT_EMAIL,
    subject: `[${ticket.prioridad||'Media'}] ${ticket.id} — ${ticket.titulo}`,
    html: plantillaBase(cuerpo)
  });
}

// ── Mesa de Ayuda IT — Confirmación al solicitante ────────────────
async function confirmarTicketMA(ticket) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS || !ticket.correo) return;
  const t = crearTransporte();
  const canal = CANAL_LABEL[ticket.canal] || ticket.canal || '';
  const cuerpo = `
    <h2 style="color:#1B3A6B;margin:0 0 8px;">Tu solicitud fue recibida</h2>
    <p style="color:#666;font-size:14px;margin:0 0 20px;">Hola <strong>${ticket.solicitante}</strong>, el equipo de TI atenderá tu solicitud.</p>
    <div style="background:#d1fae5;border:1px solid #6ee7b7;border-radius:8px;padding:14px;margin-bottom:20px;text-align:center;">
      <strong style="color:#065f46;font-size:18px;">Número de ticket: ${ticket.id}</strong>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #edf0f5;border-radius:8px;overflow:hidden;">
      ${filaDato('Asunto', ticket.titulo)}
      ${filaDato('Categoría', ticket.categoria)}
      ${filaDato('Prioridad', ticket.prioridad)}
      ${filaDato('Canal de entrada', canal)}
      ${filaDato('Estado', 'Nuevo')}
    </table>
    <p style="color:#666;font-size:13px;margin-top:16px;">Recibirás actualizaciones en este correo cuando haya cambios en tu ticket.</p>`;
  await t.sendMail({
    from: `"Soporte IT PLG" <${FROM}>`,
    to: ticket.correo,
    subject: `Ticket recibido: ${ticket.id} — ${ticket.titulo}`,
    html: plantillaBase(cuerpo)
  });
}

// ── Mesa de Ayuda IT — Actualización al solicitante ───────────────
async function notificarActualizacionMA(ticket) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS || !ticket.correo) return;
  const t = crearTransporte();
  const esResuelto = ticket.estado === 'Resuelto' || ticket.estado === 'Cerrado';
  const cuerpo = `
    <h2 style="color:#1B3A6B;margin:0 0 8px;">Tu ticket fue actualizado</h2>
    <p style="color:#666;font-size:14px;margin:0 0 20px;">Hola <strong>${ticket.solicitante}</strong>.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #edf0f5;border-radius:8px;overflow:hidden;margin-bottom:20px;">
      ${filaDato('Ticket', ticket.id)}
      ${filaDato('Asunto', ticket.titulo)}
      ${filaDato('Nuevo estado', `<span style="color:${colorEstado(ticket.estado)};font-weight:700">${ticket.estado}</span>`)}
      ${ticket.tecnicoAsignado ? filaDato('Técnico', ticket.tecnicoAsignado) : ''}
    </table>
    ${esResuelto ? '<div style="background:#d1fae5;border-radius:8px;padding:12px;text-align:center;"><strong style="color:#065f46;">Tu problema ha sido resuelto. Si persiste, abre un nuevo ticket.</strong></div>' : ''}`;
  await t.sendMail({
    from: `"Soporte IT PLG" <${FROM}>`,
    to: ticket.correo,
    subject: `Ticket ${ticket.id} actualizado: ${ticket.estado}`,
    html: plantillaBase(cuerpo)
  });
}

// ── Mesa de Ayuda IT — Respuesta del técnico al usuario ──────────
async function responderPorCorreo(ticket, mensaje, autorNombre) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS || !ticket.correo) return;
  const t = crearTransporte();
  const cuerpo = `
    <h2 style="color:#1B3A6B;margin:0 0 8px;">Respuesta del equipo de TI</h2>
    <p style="color:#666;font-size:14px;margin:0 0 4px;">Ticket: <strong>${ticket.id}</strong></p>
    <p style="color:#666;font-size:14px;margin:0 0 20px;">Técnico: <strong>${autorNombre || 'Soporte IT'}</strong></p>
    <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:16px;margin-bottom:20px;">
      <p style="margin:0;font-size:15px;color:#1e40af;white-space:pre-wrap">${mensaje}</p>
    </div>
    <p style="color:#888;font-size:12px;">Puedes responder a este correo o contactar directamente a soporte@plg.com.sv</p>`;
  await t.sendMail({
    from: `"Soporte IT PLG" <${FROM}>`,
    to: ticket.correo,
    replyTo: IT_EMAIL,
    subject: `Re: Ticket ${ticket.id} — ${ticket.titulo}`,
    html: plantillaBase(cuerpo)
  });
}

module.exports = {
  notificarNuevoTicket, confirmarAlSolicitante, notificarActualizacion,
  notificarTicketMA, confirmarTicketMA, notificarActualizacionMA, responderPorCorreo
};
