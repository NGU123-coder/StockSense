import nodemailer from 'nodemailer';
import { env } from '../config/env';

/**
 * Real SMTP when SMTP_HOST is configured; otherwise a JSON transport that
 * just logs the message, so local development never needs a mail server.
 */
const transporter = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT ?? 587,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  : nodemailer.createTransport({ jsonTransport: true });

export async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
  attachments?: { filename: string; content: Buffer }[];
}) {
  const info = await transporter.sendMail({ from: env.MAIL_FROM, ...opts });
  if (!env.SMTP_HOST && env.NODE_ENV !== 'test') {
    console.log(`✉  [dev mail] to=${opts.to} subject="${opts.subject}"`);
  }
  return info;
}
