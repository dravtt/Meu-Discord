import nodemailer from 'nodemailer';
import { config } from './config.js';

const transport = config.smtpUrl ? nodemailer.createTransport(config.smtpUrl) : null;

/** Sends the verification code. Without SMTP configured, prints it in the server window instead. */
export async function sendVerificationCode(to: string, name: string, code: string) {
  if (!transport) {
    console.log(`\n[Voka] Código de verificação para ${to}: ${code}  (configure SMTP_URL no server/.env para mandar por e-mail)\n`);
    return;
  }
  await transport.sendMail({
    from: config.mailFrom,
    to,
    subject: `${code} é o seu código do Voka`,
    text: `Oi, ${name}!\n\nSeu código para confirmar o e-mail no Voka é: ${code}\n\nEle vale por 15 minutos. Se não foi você, ignore este e-mail.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px;background:#0d0b14;color:#eee;border-radius:16px">
      <h2 style="color:#a78bfa;margin:0 0 12px">Voka</h2><p>Oi, ${name.replace(/[<>&]/g, '')}!</p><p>Seu código para confirmar o e-mail:</p>
      <p style="font-size:32px;letter-spacing:8px;font-weight:bold;background:#1c1530;padding:14px;border-radius:10px;text-align:center">${code}</p>
      <p style="color:#999;font-size:13px">Ele vale por 15 minutos. Se não foi você, ignore este e-mail.</p></div>`,
  });
}
