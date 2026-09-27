// qr_to_png.js — starts the WhatsApp connection just to grab the raw QR string,
// then renders it as a real scannable PNG (terminal ASCII QR can't be camera-scanned).
require('dotenv').config();
const path = require('path');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const pino = require('pino');

const AUTH_DIR = path.join(__dirname, 'auth_session');
const logger = pino({ level: 'silent' });

async function run() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({ version, auth: state, logger, printQRInTerminal: false });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async (update) => {
    const { qr, connection, lastDisconnect } = update;
    if (qr) {
      const outPath = path.join(__dirname, 'wa_qr.png');
      const tmpPath = outPath + '.tmp';
      await QRCode.toFile(tmpPath, qr, { width: 500 });
      require('fs').renameSync(tmpPath, outPath);
      console.log('QR_SAVED:' + outPath + ' at ' + new Date().toISOString());
    }
    if (connection === 'open') {
      console.log('CONNECTED');
      process.exit(0);
    }
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      console.log('CLOSED code=' + statusCode + ' loggedOut=' + loggedOut);
      if (!loggedOut) {
        setTimeout(run, 1000); // reconnect and get a fresh QR
      } else {
        console.log('Logged out — delete auth_session/ and rerun.');
        process.exit(1);
      }
    }
  });
}
run();
