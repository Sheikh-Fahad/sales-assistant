// catalog.js — reads the live product catalog from a public Google Sheet (CSV export)
// No auth needed: sheet must be shared as "Anyone with the link can view".

const fetch = require('node-fetch');

let cache = { text: null, fetchedAt: 0 };
const CACHE_TTL_MS = 60 * 1000; // refresh at most once a minute

function csvUrl(sheetId, tabName) {
  const base = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
  if (tabName) {
    // gid-based tab selection isn't available without the numeric gid;
    // default export pulls the first/visible sheet. For multi-tab sheets,
    // set SHEET_GID in .env instead.
  }
  return base;
}

async function fetchCatalogRaw() {
  const sheetId = process.env.SHEET_ID;
  const gid = process.env.SHEET_GID; // optional, for a specific tab
  if (!sheetId) throw new Error('SHEET_ID not set in .env');

  const now = Date.now();
  if (cache.text && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.text;
  }

  let url = csvUrl(sheetId);
  if (gid) url += `&gid=${gid}`;
  url += `&t=${now}`; // cache-bust

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch catalog sheet: HTTP ${res.status}`);
  }
  const text = await res.text();
  cache = { text, fetchedAt: now };
  return text;
}

// Very small CSV parser (handles quoted fields with commas)
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * Returns the catalog as an array of objects (keyed by header row),
 * and also the raw CSV text (useful to hand straight to Claude as context).
 */
async function getCatalog() {
  const text = await fetchCatalogRaw();
  const rows = parseCsv(text).filter(r => r.some(cell => cell.trim() !== ''));
  if (rows.length === 0) return { rows: [], raw: text };

  const headers = rows[0].map(h => h.trim());
  const items = rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (r[idx] || '').trim(); });
    return obj;
  });

  return { rows: items, raw: text, headers };
}

module.exports = { getCatalog, fetchCatalogRaw };
