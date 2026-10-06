// Cloudflare Worker entry: wires the D1 database, the email binding and the daily clean-up to
// handler.js. Deployed at https://feedback.yulid.org (see README.md).
import { EmailMessage } from 'cloudflare:email'
import { handle, mimeMessage, sweep } from './handler.js'

export default {
  async fetch(request, env) {
    return handle(request, {
      db: env.DB,
      salt: env.IP_SALT,
      sendMail: env.MAIL && env.MAIL_TO ? async ({ id, subject, text }) => {
        const raw = mimeMessage({ from: env.MAIL_FROM, to: env.MAIL_TO, subject, text, id })
        await env.MAIL.send(new EmailMessage(env.MAIL_FROM, env.MAIL_TO, raw))
      } : undefined,
    })
  },
  async scheduled(_event, env) {
    await sweep(env.DB)
  },
}
