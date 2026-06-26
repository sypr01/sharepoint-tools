const nodemailer = require("nodemailer");

module.exports = async function (context, req) {
  const resultado = {
    vars: {
      SMTP_USER: process.env.SMTP_USER || "NO CONFIGURADA",
      SMTP_PASS: process.env.SMTP_PASS ? "***configurada***" : "NO CONFIGURADA",
      IT_EMAIL:  process.env.IT_EMAIL  || "NO CONFIGURADA"
    },
    smtp: null,
    error: null
  };

  try {
    const transporte = nodemailer.createTransport({
      host:   "smtp.office365.com",
      port:   587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 10000
    });

    await transporte.verify();
    resultado.smtp = "Conexion exitosa";

    await transporte.sendMail({
      from:    `"Test PLG" <${process.env.SMTP_USER}>`,
      to:      process.env.IT_EMAIL || process.env.SMTP_USER,
      subject: "TEST - Sistema de Tickets PLG",
      text:    "Si recibes este correo, el sistema de notificaciones funciona correctamente."
    });

    resultado.envio = "Correo enviado exitosamente";
  } catch (e) {
    resultado.error = e.message;
    resultado.codigo = e.code;
    resultado.respuesta = e.response;
  }

  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(resultado, null, 2)
  };
};
