const nodemailer = require("nodemailer");

const IT_EMAIL = process.env.IT_EMAIL || "soporte@plg.com.sv";

function crearTransporte() {
  return nodemailer.createTransport({
    host: "smtp.office365.com",
    port: 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    tls: { ciphers: "SSLv3" }
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
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F0F4F9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F0F4F9;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#1B3A6B,#2F5AA8);padding:24px 32px;border-bottom:4px solid #CC1F2A;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <div style="font-size:20px;font-weight:800;color:white;letter-spacing:-0.3px;">PLG · Soporte de TI</div>
                  <div style="font-size:12px;color:rgba(255,255,255,0.7);margin-top:3px;">PANAMERICAN LOGISTICS GROUP</div>
                </td>
                <td align="right">
                  <div style="background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);border-radius:6px;padding:6px 12px;font-size:20px;">🎫</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Body -->
        <tr><td style="padding:32px;">${contenido}</td></tr>
        <!-- Footer -->
        <tr>
          <td style="background:#F0F4F9;padding:16px 32px;border-top:1px solid #dde3ed;text-align:center;">
            <p style="margin:0;font-size:11px;color:#999;">Sistema de Tickets IT · PANAMERICAN LOGISTICS GROUP · informatica@plg.com.sv</p>
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
    <td style="padding:8px 12px;font-size:12px;font-weight:700;color:#778;text-transform:uppercase;letter-spacing:.5px;background:#F8FAFC;width:140px;">${label}</td>
    <td style="padding:8px 12px;font-size:14px;color:#333;">${valor || "—"}</td>
  </tr>`;
}

// ── Email: nuevo ticket → a IT ────────────────────────────────────
async function notificarNuevoTicket(ticket) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return;
  const transporte = crearTransporte();
  const cuerpo = `
    <h2 style="margin:0 0 4px;font-size:22px;color:#1B3A6B;">Nuevo ticket recibido</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#666;">Se ha abierto un nuevo ticket de soporte que requiere atención.</p>

    <div style="background:#fff8ed;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;margin-bottom:20px;">
      <span style="font-size:13px;font-weight:700;color:#92400e;">ID del Ticket: ${ticket.id}</span>
    </div>

    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #edf0f5;border-radius:8px;overflow:hidden;margin-bottom:20px;">
      ${filaDato("Título", `<strong>${ticket.titulo}</strong>`)}
      ${filaDato("Categoría", ticket.categoria)}
      ${filaDato("Prioridad", `<span style="background:${colorPrioridad(ticket.prioridad)}22;color:${colorPrioridad(ticket.prioridad)};padding:3px 10px;border-radius:12px;font-size:12px;font-weight:700;">${ticket.prioridad}</span>`)}
      ${filaDato("Solicitante", ticket.solicitante)}
      ${filaDato("Correo", ticket.email)}
      ${filaDato("Teléfono", ticket.extension)}
      ${filaDato("Departamento", ticket.departamento)}
      ${filaDato("Fecha", new Date(ticket.fechaCreacion).toLocaleString("es-SV"))}
    </table>

    <div style="background:#F0F4F9;border-radius:8px;padding:16px;margin-bottom:24px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#778;text-transform:uppercase;">Descripción del problema</p>
      <p style="margin:0;font-size:14px;color:#444;line-height:1.6;">${ticket.descripcion}</p>
    </div>

    <p style="margin:0;font-size:13px;color:#888;text-align:center;">Ingresa al portal de tickets para asignarlo y darle seguimiento.</p>
  `;

  await transporte.sendMail({
    from: `"Soporte IT - PLG" <${process.env.SMTP_USER}>`,
    to: IT_EMAIL,
    subject: `[${ticket.prioridad.toUpperCase()}] Nuevo Ticket: ${ticket.titulo} · ${ticket.id}`,
    html: plantillaBase(cuerpo)
  });
}

// ── Email: confirmación → al solicitante ─────────────────────────
async function confirmarAlSolicitante(ticket) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS || !ticket.email) return;
  const transporte = crearTransporte();
  const cuerpo = `
    <h2 style="margin:0 0 4px;font-size:22px;color:#1B3A6B;">Tu ticket fue recibido</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#666;">Hola <strong>${ticket.solicitante}</strong>, el equipo de TI recibió tu solicitud y la atenderá a la brevedad.</p>

    <div style="background:#d1fae5;border:1px solid #6ee7b7;border-radius:8px;padding:12px 16px;margin-bottom:20px;text-align:center;">
      <span style="font-size:15px;font-weight:800;color:#065f46;">Tu número de ticket: ${ticket.id}</span>
    </div>

    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #edf0f5;border-radius:8px;overflow:hidden;margin-bottom:20px;">
      ${filaDato("Problema", ticket.titulo)}
      ${filaDato("Categoría", ticket.categoria)}
      ${filaDato("Prioridad", `<span style="background:${colorPrioridad(ticket.prioridad)}22;color:${colorPrioridad(ticket.prioridad)};padding:3px 10px;border-radius:12px;font-size:12px;font-weight:700;">${ticket.prioridad}</span>`)}
      ${filaDato("Estado", '<span style="color:#2F5AA8;font-weight:700;">Abierto</span>')}
      ${filaDato("Abierto el", new Date(ticket.fechaCreacion).toLocaleString("es-SV"))}
    </table>

    <p style="margin:0;font-size:13px;color:#888;text-align:center;">Recibirás un correo cuando tu ticket sea actualizado o resuelto.<br>Para consultas escribe a <a href="mailto:${IT_EMAIL}" style="color:#2F5AA8;">${IT_EMAIL}</a></p>
  `;

  await transporte.sendMail({
    from: `"Soporte IT - PLG" <${process.env.SMTP_USER}>`,
    to: ticket.email,
    subject: `Ticket recibido: ${ticket.id} · ${ticket.titulo}`,
    html: plantillaBase(cuerpo)
  });
}

// ── Email: actualización de estado → al solicitante ──────────────
async function notificarActualizacion(ticket) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS || !ticket.email) return;
  const transporte = crearTransporte();

  const esResuelto = ticket.estado === "Resuelto" || ticket.estado === "Cerrado";
  const emoji = { Resuelto: "✅", Cerrado: "🔒", "En Proceso": "🔧", Abierto: "📋" }[ticket.estado] || "📋";

  const cuerpo = `
    <h2 style="margin:0 0 4px;font-size:22px;color:#1B3A6B;">${emoji} Tu ticket fue actualizado</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#666;">Hola <strong>${ticket.solicitante}</strong>, hay una actualización en tu ticket de soporte.</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #edf0f5;border-radius:8px;overflow:hidden;margin-bottom:20px;">
      ${filaDato("ID Ticket", `<strong>${ticket.id}</strong>`)}
      ${filaDato("Problema", ticket.titulo)}
      ${filaDato("Nuevo estado", `<span style="background:${colorEstado(ticket.estado)}22;color:${colorEstado(ticket.estado)};padding:3px 10px;border-radius:12px;font-size:12px;font-weight:700;">${ticket.estado}</span>`)}
      ${ticket.asignado ? filaDato("Técnico asignado", ticket.asignado) : ""}
      ${filaDato("Última actualización", new Date(ticket.fechaActualizacion).toLocaleString("es-SV"))}
    </table>

    ${ticket.notas ? `
    <div style="background:#F0F4F9;border-radius:8px;padding:16px;margin-bottom:20px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#778;text-transform:uppercase;">${esResuelto ? "Solución aplicada" : "Notas del técnico"}</p>
      <p style="margin:0;font-size:14px;color:#444;line-height:1.6;">${ticket.notas}</p>
    </div>` : ""}

    ${esResuelto ? `<div style="background:#d1fae5;border:1px solid #6ee7b7;border-radius:8px;padding:14px;text-align:center;margin-bottom:16px;">
      <p style="margin:0;font-size:14px;color:#065f46;font-weight:600;">Tu problema ha sido resuelto. Si el inconveniente persiste, abre un nuevo ticket.</p>
    </div>` : ""}

    <p style="margin:0;font-size:13px;color:#888;text-align:center;">¿Tienes dudas? Escribe a <a href="mailto:${IT_EMAIL}" style="color:#2F5AA8;">${IT_EMAIL}</a></p>
  `;

  await transporte.sendMail({
    from: `"Soporte IT - PLG" <${process.env.SMTP_USER}>`,
    to: ticket.email,
    subject: `${emoji} Ticket ${ticket.id} → ${ticket.estado}`,
    html: plantillaBase(cuerpo)
  });
}

module.exports = { notificarNuevoTicket, confirmarAlSolicitante, notificarActualizacion };
