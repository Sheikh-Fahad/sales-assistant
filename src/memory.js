// memory.js — simple per-customer conversation history, persisted to disk as JSON.
// Independent, no external DB required.

const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'conversations.json');
const MAX_HISTORY = 20; // keep last N turns per customer to bound prompt size

function loadAll() {
  if (!fs.existsSync(STORE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveAll(data) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

function getHistory(customerNumber) {
  const all = loadAll();
  return all[customerNumber] || [];
}

function appendTurn(customerNumber, role, text) {
  const all = loadAll();
  if (!all[customerNumber]) all[customerNumber] = [];
  all[customerNumber].push({ role, text, ts: new Date().toISOString() });
  if (all[customerNumber].length > MAX_HISTORY) {
    all[customerNumber] = all[customerNumber].slice(-MAX_HISTORY);
  }
  saveAll(all);
}

function clearHistory(customerNumber) {
  const all = loadAll();
  delete all[customerNumber];
  saveAll(all);
}

module.exports = { getHistory, appendTurn, clearHistory };
