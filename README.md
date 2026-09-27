# Sales Assistant

A standalone WhatsApp sales assistant bot. It connects to WhatsApp, reads a
product catalog from a Google Sheet, answers customer questions (including
in Bangla) using Claude as the brain, and logs completed orders. Fully
independent — no dependency on Hermes or any other framework.

## How it works

1. **WhatsApp connection** (`src/index.js`) — uses
   [Baileys](https://github.com/WhiskeySockets/Baileys) to connect to
   WhatsApp as a linked device. On first run it prints a QR code in the
   terminal; scan it with WhatsApp (Settings > Linked Devices > Link a
   Device). The session is saved to `auth_session/` so you don't have to
   re-scan on every restart.

2. **Incoming messages** — every non-group message triggers:
   - Fetch the current product catalog (`src/catalog.js`, read from a
     Google Sheet).
   - Load the customer's recent conversation history (`src/memory.js`).
   - Ask Claude for a reply (`src/brain.js`), passing the catalog, history,
     and the new message.
   - Send the reply back on WhatsApp.
   - If Claude detects the conversation completed an order, save it
     (`src/orders.js`) and clear that customer's history for a fresh start.

3. **Claude backend** (`src/brain.js`) — two modes, switchable via
   `.env`, no code changes needed:
   - `CLAUDE_MODE=cli` (default) — uses the local Claude Code CLI binary,
     authenticated with `CLAUDE_CODE_OAUTH_TOKEN` (a long-lived token from
     your Claude subscription, generated via `claude setup-token`). No
     per-token billing.
   - `CLAUDE_MODE=api` — calls the Anthropic API directly, billed per
     token, using `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL`.

4. **Order logging** — completed orders are posted to a Google Apps Script
   web app (`apps_script_orders_webhook.gs`) which appends them as rows to
   an "Orders" sheet in your Google Sheet.

## Setup

### Prerequisites

- Node.js 18+
- A WhatsApp account/number to link as the bot
- A Google Sheet containing your product catalog
- Either a Claude subscription (for CLI mode) or an Anthropic API key
  (for API mode)

### 1. Install dependencies

```bash
npm install
```

### 2. Set up the Google Sheet

- Create a Google Sheet with your product catalog (one tab), e.g. columns
  like Product, Price, Stock, etc.
- Note the Sheet ID (the long ID in the sheet's URL) and the catalog tab
  name.
- For order logging: open the sheet, go to
  `Extensions > Apps Script`, paste in the contents of
  `apps_script_orders_webhook.gs`, then
  `Deploy > New deployment > Type: Web app`, set "Execute as: Me" and
  "Who has access: Anyone", deploy, and copy the resulting web app URL.

### 3. Configure environment variables

Copy `.env.example` to `.env` and fill it in:

```bash
cp .env.example .env
```

| Variable | Required for | Description |
|---|---|---|
| `CLAUDE_MODE` | always | `cli` or `api` |
| `CLAUDE_CODE_OAUTH_TOKEN` | `cli` mode | Get with `claude setup-token` |
| `ANTHROPIC_API_KEY` | `api` mode | Your Anthropic API key |
| `ANTHROPIC_MODEL` | `api` mode | e.g. `claude-sonnet-4-5` |
| `SHEET_ID` | always | Google Sheet ID with the product catalog |
| `SHEET_CATALOG_TAB` | always | Name of the catalog tab in the sheet |
| `ORDERS_WEBHOOK_URL` | always | Apps Script web app URL from step 2 |
| `OWNER_NOTIFY_NUMBER` | optional | WhatsApp number to notify on new orders |

Never commit `.env` — it's already git-ignored.

### 4. Run the bot

```bash
npm start
```

- On first run, scan the QR code shown in the terminal with WhatsApp
  (Linked Devices).
- Once connected you'll see `WhatsApp connected. Sales assistant is live.`
- The bot now replies automatically to any direct (non-group) message.

### 5. Keep it running

By default the process stops when the terminal closes or the machine
restarts — there's no auto-start configured. To keep it always on, run it
with a process manager, e.g.:

```bash
npm install -g pm2
pm2 start src/index.js --name sales-assistant
pm2 save
```

## Notes

- If WhatsApp logs the session out, delete `auth_session/` and restart to
  re-pair with a new QR code.
- `conversations.json` (created at runtime) holds per-customer chat
  history — it's git-ignored since it can contain customer data.
- Group messages are ignored by design; the bot only responds to direct
  messages.
