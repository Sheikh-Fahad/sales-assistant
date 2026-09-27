// index.js — standalone WhatsApp sales assistant.
// Own Baileys connection, own Claude Code CLI call, own Google Sheet catalog reader.
// No dependency on Hermes whatsoever.

require('dotenv').config();
const path = require('path');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

const { getCatalog } = require('./catalog');
const brain = require('./brain');
const memory = require('./memory');
const orders = require('./orders');

const AUTH_DIR = path.join(__dirname, '..', 'auth_session');
const logger = pino({ level: 'silent' }); // keep noisy Baileys logs quiet

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false, // we handle QR display ourselves below
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\nScan this QR code with WhatsApp (Linked Devices):\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      console.log(`Connection closed. Logged out: ${loggedOut}. Reconnecting: ${!loggedOut}`);
      if (!loggedOut) {
        startBot();
      } else {
        console.log('Session logged out. Delete auth_session/ and restart to re-pair.');
      }
    } else if (connection === 'open') {
      console.log('WhatsApp connected. Sales assistant is live.');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        if (!msg.message || msg.key.fromMe) continue;
        const from = msg.key.remoteJid;
        if (!from || from.endsWith('@g.us')) continue; // ignore group messages

        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          '';
        if (!text.trim()) continue;

        console.log(`[in] ${from}: ${text}`);

        await sock.sendPresenceUpdate('composing', from);

        const { raw: catalogRaw } = await getCatalog();
        const history = memory.getHistory(from);

        const { reply, orderComplete } = await brain.ask(catalogRaw, history, text);

        memory.appendTurn(from, 'user', text);
        memory.appendTurn(from, 'assistant', reply);

        await sock.sendMessage(from, { text: reply });
        console.log(`[out] ${from}: ${reply}`);

        if (orderComplete) {
          const saved = await orders.saveOrder(orderComplete, from);
          console.log(`[order] saved:`, saved);

          memory.clearHistory(from); // fresh start for next conversation
        }
      } catch (err) {
        console.error('[error] failed to handle message:', err);
      }
    }
  });
}

startBot().catch(err => {
  console.error('Fatal error starting bot:', err);
  process.exit(1);
});
