// orders.js — writes completed orders to a local text file in this same project folder.
// No Google Sheet / webhook dependency — pure local storage, always works offline.
// orders.txt   -> human-readable log, one order per block, easy to open and read
// orders.log.jsonl -> machine-readable line-per-order backup (kept for safety/history)

const fs = require('fs');
const path = require('path');

const TEXT_PATH = path.join(__dirname, '..', 'orders.txt');
const JSONL_PATH = path.join(__dirname, '..', 'orders.log.jsonl');

async function saveOrder(order, customerNumber) {
  const record = {
    ts: new Date().toISOString(),
    customerNumber,
    ...order,
  };

  // Machine-readable backup line
  fs.appendFileSync(JSONL_PATH, JSON.stringify(record) + '\n');

  // Human-readable block, appended to orders.txt
  const block =
    `----------------------------------------\n` +
    `Time:     ${record.ts}\n` +
    `Customer: ${customerNumber.replace('@s.whatsapp.net', '')}\n` +
    `Product:  ${record.product || ''}\n` +
    `Quantity: ${record.quantity || ''}\n` +
    `Address:  ${record.address || ''}\n` +
    `Phone:    ${record.phone || ''}\n` +
    `----------------------------------------\n\n`;

  fs.appendFileSync(TEXT_PATH, block);
  console.log(`[orders] saved to ${TEXT_PATH}`);

  return record;
}

module.exports = { saveOrder, TEXT_PATH, JSONL_PATH };
