/**
 * Telegram for main chat: a bot the user made with @BotFather, bound to them by a pairing code,
 * plus the relay that carries their messages into main chat and the replies back.
 */
import type { Context } from '@deepseek-ai/cordis'
import { RELAY_WORDS, RemoteRelay } from './remote-relay.ts'
import { plainText, splitText } from './remote-plain.ts'
import { RemoteApp, refused, type AppHost } from './remote-app.ts'
import { TELEGRAM_TEXT_LIMIT, TelegramClient, TelegramLink, type TelegramSaved } from './telegram-bot.ts'

/** Main chat messages from Telegram carry this prefix on their request id (`source.rpcId`). */
export const TELEGRAM_REQUEST = 'telegram:'

const WORDS = {
  zh: {
    paired: '已和 TheOne 绑定。之后在这里说的话会进到你电脑上的 TheOne 主聊天，回复也会发回这里。',
    expired: 'Telegram 机器人的 token 已失效（可能在 @BotFather 里重置过），在 TheOne 设置的「Telegram」里重新填写即可恢复。',
  },
  en: {
    paired: 'Bound to TheOne. What you say here now goes to TheOne\'s main chat on your computer, and the replies come back here.',
    expired: 'The Telegram bot token no longer works (it may have been reset in @BotFather). Enter it again under Telegram in TheOne\'s settings.',
  },
}

export class TelegramApp extends RemoteApp<TelegramSaved> {
  readonly client = new TelegramClient()
  readonly link: TelegramLink
  readonly relay: RemoteRelay

  constructor(ctx: Context, host: AppHost<TelegramSaved>) {
    super(ctx)
    const words = () => this.relay.words() === RELAY_WORDS.en ? WORDS.en : WORDS.zh
    this.relay = new RemoteRelay(ctx, host, {
      name: TELEGRAM_REQUEST.slice(0, -1),
      available: () => !!this.link.current()?.owner,
      send: text => this.say(text),
      typing: async () => {
        const saved = this.link.current()
        if (saved?.owner) await this.client.typing(saved.token, saved.owner.chatId)
      },
    })
    this.link = new TelegramLink(this.client, {
      load: host.load,
      save: host.save,
      deliver: message => this.relay.receive(message.id, message.text),
      expired: () => this.relay.note(words().expired),
      log: message => console.warn(`TheOne: ${message}`),
    }, words)
  }

  /** Text to the owner, plain and in parts Telegram accepts. */
  async say(text: string): Promise<void> {
    const saved = this.link.current()
    if (!saved?.owner) return
    for (const part of splitText(plainText(text), TELEGRAM_TEXT_LIMIT)) await this.client.send(saved.token, saved.owner.chatId, part)
  }

  protected async action(row: Record<string, unknown>): Promise<Response | undefined> {
    if (row.action !== 'connect') return refused('INVALID_INPUT')
    if (typeof row.token !== 'string' || row.token.length > 200) return refused('TELEGRAM_TOKEN_INVALID')
    try { await this.link.connect(row.token) }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Telegram answers 401 or 404 for a token that is not a bot's.
      return refused(/TOKEN_INVALID|TELEGRAM_40[14]/.test(message) ? 'TELEGRAM_TOKEN_INVALID' : 'TELEGRAM_UNREACHABLE')
    }
  }
}
