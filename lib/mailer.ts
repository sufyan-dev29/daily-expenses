import 'server-only';
import nodemailer from 'nodemailer';
import type { SmtpConfig } from '@/lib/secrets';

export async function sendMail(cfg: SmtpConfig, to: string, subject: string, text: string, html?: string) {
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  await transport.sendMail({ from: cfg.from, to, subject, text, html });
}

export function recoveryEmail(link: string) {
  const subject = 'Reset your password';
  const text = `Someone asked to reset the password for your expense tracker.\n\nOpen this link to choose a new one:\n${link}\n\nIf this wasn't you, ignore this email.`;
  const html = `<p>Someone asked to reset the password for your expense tracker.</p><p><a href="${link}">Choose a new password</a></p><p>If this wasn't you, ignore this email.</p>`;
  return { subject, text, html };
}
