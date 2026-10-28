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

const esc = (s: string) => s.replace(/[<>&"]/g, '');

/** Warns the owner of an account that someone keeps getting the password wrong. */
export async function sendLoginAlert(to: string, name: string, info: { tries: number; ip: string; when: Date }) {
  const when = info.when.toLocaleString('pt-BR');
  if (!transport) {
    console.log(`\n[Voka] Alerta de segurança para ${to}: ${info.tries} senhas erradas (IP ${info.ip}, ${when})  (configure SMTP_URL para mandar por e-mail)\n`);
    return;
  }
  await transport.sendMail({
    from: config.mailFrom,
    to,
    subject: 'Atividade estranha na sua conta do Voka',
    text: `Oi, ${name}!\n\nAlguém errou a senha da sua conta ${info.tries} vezes seguidas (IP ${info.ip}, ${when}).\n\nSe foi você, pode ignorar. Se não foi, troque sua senha em Configurações > Minha conta e não passe sua senha para ninguém.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:440px;margin:auto;padding:24px;background:#0d0b14;color:#eee;border-radius:16px">
      <h2 style="color:#a78bfa;margin:0 0 12px">Voka</h2><p>Oi, ${esc(name)}!</p>
      <p style="background:#3a1020;border:1px solid #7f1d1d;padding:12px;border-radius:10px"><b>Detectamos uma anomalia:</b> alguém errou a senha da sua conta <b>${info.tries} vezes</b> seguidas.</p>
      <p style="color:#bbb;font-size:14px">IP: ${esc(info.ip)}<br>Quando: ${esc(when)}</p>
      <p>Se foi você, pode ignorar. Se não foi, troque sua senha em <b>Configurações &gt; Minha conta</b> e não passe sua senha para ninguém.</p></div>`,
  });
}

/** Sends the 6-digit code used to choose a new password. */
export async function sendPasswordResetCode(to: string, name: string, code: string) {
  if (!transport) {
    console.log(`\n[Voka] Código para redefinir a senha de ${to}: ${code}  (configure SMTP_URL no server/.env para mandar por e-mail)\n`);
    return;
  }
  await transport.sendMail({
    from: config.mailFrom,
    to,
    subject: `${code} é o código para redefinir sua senha do Voka`,
    text: `Oi, ${name}!\n\nSeu código para redefinir a senha do Voka é: ${code}\n\nEle vale por 15 minutos. Se não foi você que pediu, ignore este e-mail: sua senha continua a mesma.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px;background:#0d0b14;color:#eee;border-radius:16px">
      <h2 style="color:#a78bfa;margin:0 0 12px">Voka</h2><p>Oi, ${esc(name)}!</p><p>Seu código para redefinir a senha:</p>
      <p style="font-size:32px;letter-spacing:8px;font-weight:bold;background:#1c1530;padding:14px;border-radius:10px;text-align:center">${code}</p>
      <p style="color:#999;font-size:13px">Ele vale por 15 minutos. Se não foi você que pediu, ignore este e-mail: sua senha continua a mesma.</p></div>`,
  });
}
