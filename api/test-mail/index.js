const { notificarNuevoTicket, confirmarAlSolicitante } = require("../mailer");

module.exports = async function (context, req) {
  const resultado = {
    vars: {
      SMTP_USER: process.env.SMTP_USER || "NO CONFIGURADA",
      SMTP_PASS: process.env.SMTP_PASS ? "***ok***" : "NO CONFIGURADA",
      IT_EMAIL:  process.env.IT_EMAIL  || "NO CONFIGURADA"
    },
    notificarIT:       null,
    confirmarSolicit:  null,
    errorIT:           null,
    errorSolicitante:  null
  };

  const ticketPrueba = {
    id:                "TKT-TEST-001",
    titulo:            "Prueba del sistema de correos",
    descripcion:       "Este es un ticket de prueba para verificar que los correos funcionan.",
    categoria:         "Software",
    prioridad:         "Media",
    estado:            "Abierto",
    solicitante:       "Usuario Prueba",
    email:             process.env.SMTP_USER, // enviar al mismo correo de soporte
    extension:         "100",
    departamento:      "IT",
    asignado:          "",
    notas:             "",
    fechaCreacion:     new Date().toISOString(),
    fechaActualizacion: new Date().toISOString()
  };

  try {
    await notificarNuevoTicket(ticketPrueba);
    resultado.notificarIT = "Enviado OK";
  } catch (e) {
    resultado.errorIT = e.message;
  }

  try {
    await confirmarAlSolicitante(ticketPrueba);
    resultado.confirmarSolicit = "Enviado OK";
  } catch (e) {
    resultado.errorSolicitante = e.message;
  }

  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(resultado, null, 2)
  };
};
