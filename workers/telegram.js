// telegram.js - Telegram Bot API client

export class TelegramBot {
  constructor(token, chatId) {
    this.token = token
    this.chatId = chatId
    this.baseUrl = `https://api.telegram.org/bot${token}`
  }

  async sendMessage(text, options = {}) {
    const payload = {
      chat_id: this.chatId,
      text,
      parse_mode: 'HTML',
      ...options,
    }

    const response = await fetch(`${this.baseUrl}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(`Telegram API error: ${error.description}`)
    }

    return response.json()
  }

  async sendAlert(asset, protocol, confidence, metadata = {}) {
    const message = this.formatAlert(asset, protocol, confidence, metadata)
    return this.sendMessage(message)
  }

  formatAlert(asset, protocol, confidence, { delta = null, spot = null, dca = null, prevProtocol = null } = {}) {
    let text = `<b>🤖 RL Alert</b>\n`
    text += `Asset: <b>${asset}</b>\n`

    if (prevProtocol && prevProtocol !== protocol) {
      text += `Protocol: <b>${prevProtocol}</b> → <b>${protocol}</b>\n`
    } else {
      text += `Protocol: <b>${protocol}</b>\n`
    }

    text += `Confidence: <b>${(confidence * 100).toFixed(0)}%</b>\n`

    if (spot) text += `Spot: $${spot.toLocaleString()}\n`
    if (dca) text += `DCA: $${dca.toLocaleString()}\n`
    if (delta !== null) text += `Delta: <code>${delta.toFixed(3)}</code>\n`

    text += `\n<i>Timestamp: ${new Date().toISOString()}</i>`

    return text
  }
}

export default TelegramBot
