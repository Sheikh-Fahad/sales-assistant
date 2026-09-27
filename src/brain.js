// brain.js — sends the conversation + catalog to Claude Code (print mode) and gets a reply.
// Uses the project's local Claude Code CLI binary, authenticated via CLAUDE_CODE_OAUTH_TOKEN
// (a long-lived token generated from the owner's Claude subscription via `claude setup-token`).
// Fully independent of Hermes — this project owns its own claude binary and its own token.

const { spawn } = require('child_process');
const path = require('path');
const fetch = require('node-fetch');

const CLAUDE_BIN = path.join(__dirname, '..', 'node_modules', '.bin', 'claude');

// Two ways to talk to Claude:
// - "cli" (default): local Claude Code CLI, billed against the owner's Claude subscription
//   via CLAUDE_CODE_OAUTH_TOKEN.
// - "api": direct Anthropic API call, billed per-token via ANTHROPIC_API_KEY.
// Switch by setting CLAUDE_MODE=api in .env and providing ANTHROPIC_API_KEY (+ optionally
// ANTHROPIC_MODEL, default below). No code changes needed to switch later.
const CLAUDE_MODE = (process.env.CLAUDE_MODE || 'cli').toLowerCase();
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

const SYSTEM_PROMPT = `You are a WhatsApp sales representative for a business. The exact products you sell are whatever appears in the catalog data given to you below — do not assume any specific product category, learn it fresh from the catalog each time.

IMPORTANT: Do not use any tools, do not search files, drives, or the web. Answer only from the catalog data and conversation text given to you directly in the prompt below.

STRICT RULES — follow exactly:
1. You ONLY discuss products, prices, and orders from the catalog data given to you below. Never invent products, prices, or details that aren't in the catalog.
2. If the customer asks anything unrelated to buying from this shop (general chit-chat, other topics, personal questions, world news, etc.), respond warmly first, a friendly line acknowledging them, then gently steer to sales, never a flat refusal. Example tone: "Haha, I'm just the shop assistant so I can't really chat about that, but I'd love to help you find something good here. Want to hear what we've got?" Never open with "Sorry, I can only..." that reads cold and robotic on WhatsApp.
3. Understand what the customer needs (use case, budget, preferences) through natural conversation — don't interrogate with a rigid form.
4. When recommending a product, briefly explain WHY it's a good fit for their need (value, quality, fit for their use case) — a real, useful reason, not generic hype.
5. Be warm, confident, persuasive, and human — like a good in-store salesperson, not a robotic chatbot. Short WhatsApp-style messages, no markdown formatting, no bullet lists, no emojis unless natural.
6. Never use em dashes or long hyphens (—, --) anywhere in your reply, they read as AI-generated. Write like a real person texting: use commas, periods, or just start a new sentence instead.
7. To complete an order you must collect: which product (exact item from catalog), quantity, delivery address, and a contact phone number. Once you have all of these, confirm the order back to the customer in one clear message and say something like "Got it, our team will confirm and get this shipped to you soon."
8. Never discuss payment processing, never ask for card details — cash on delivery / manual payment arrangement is handled by the human team afterward, just collect the order.
9. Never claim to be human when directly asked — if asked "are you a bot," say you're the shop's sales assistant, but keep it brief and steer back to helping them buy.
10. If the catalog data doesn't contain what the customer wants, say so honestly and offer the closest available alternative from the catalog, or offer to note their request for the team.

At the end of your reply, if and only if you now have ALL FOUR order fields (product, quantity, delivery address, phone number) confirmed by the customer in this conversation, append on a new line exactly:
ORDER_COMPLETE: {"product":"...","quantity":"...","address":"...","phone":"..."}
Otherwise do not append anything.`;

function buildPrompt(catalogRaw, history, customerMessage) {
  const historyText = history
    .map(h => `${h.role === 'user' ? 'Customer' : 'You'}: ${h.text}`)
    .join('\n');

  return `Here is the product catalog for this shop (CSV data, live from our system — this is the only source of truth for products/prices/stock):
${catalogRaw}

CONVERSATION SO FAR:
${historyText || '(this is the first message)'}

New message from customer:
${customerMessage}

Reply as the sales assistant, following all rules in your system prompt.`;
}

/**
 * Extracts the ORDER_COMPLETE block (if present) from a raw reply and splits it
 * into { reply, orderComplete }. Shared by both the CLI and API code paths.
 */
function parseReply(text) {
  const match = text.match(/ORDER_COMPLETE:\s*(\{.*\})\s*$/s);
  let orderComplete = null;
  let reply = text;
  if (match) {
    try {
      orderComplete = JSON.parse(match[1]);
      reply = text.slice(0, match.index).trim();
    } catch (e) {
      // malformed JSON in order block — ignore, treat as no order
    }
  }
  return { reply: reply.trim(), orderComplete };
}

/**
 * Calls the Anthropic API directly (no Claude Code CLI / subscription involved).
 * Used when CLAUDE_MODE=api and ANTHROPIC_API_KEY is set.
 * Returns { reply: string, orderComplete: object|null }
 */
async function askViaApi(catalogRaw, history, customerMessage) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('CLAUDE_MODE=api is set but ANTHROPIC_API_KEY is missing in .env');
  }

  const prompt = buildPrompt(catalogRaw, history, customerMessage);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${body.slice(0, 500)}`);
  }

  const data = await res.json();
  const text = (data.content || []).map(b => b.text || '').join('').trim();
  return parseReply(text);
}

/**
 * Calls Claude Code in print mode (non-interactive) with the sales system prompt.
 * Returns { reply: string, orderComplete: object|null }
 */
function askViaCli(catalogRaw, history, customerMessage) {
  return new Promise((resolve, reject) => {
    const prompt = buildPrompt(catalogRaw, history, customerMessage);

    const args = [
      '-p',
      '--append-system-prompt', SYSTEM_PROMPT,
      '--max-turns', '3',
      '--output-format', 'json',
      '--tools', '',        // disable all agentic tools — this is a plain Q&A call, not a coding task
      '--strict-mcp-config', // block auto-discovered MCP connectors (e.g. Drive) from the account
    ];

    const env = { ...process.env };

    const shellPath = 'C:/Users/sheik/AppData/Local/hermes/git/usr/bin/bash.exe';
    const claudeBinFwd = CLAUDE_BIN.replace(/\\/g, '/');
    const quotedArgs = args.map(a => `'${a.replace(/'/g, `'\\''`)}'`).join(' ');
    const cmdLine = `'${claudeBinFwd}' ${quotedArgs}`;

    const child = spawn(shellPath, ['-c', cmdLine], {
      env,
      cwd: require('os').tmpdir().replace(/\\/g, '/'), // neutral dir so Claude Code has no project context to "helpfully" read
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });

    child.stdin.write(prompt);
    child.stdin.end();

    child.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`claude exited with code ${code}: ${stderr.slice(0, 500)}`));
      }
      try {
        const parsed = JSON.parse(stdout);
        const text = parsed.result || '';
        resolve(parseReply(text));
      } catch (e) {
        reject(new Error(`Failed to parse claude output: ${e.message}\nRaw: ${stdout.slice(0, 500)}`));
      }
    });

    child.on('error', reject);
  });
}

/**
 * Public entry point — routes to the CLI or API implementation based on CLAUDE_MODE.
 * Returns { reply: string, orderComplete: object|null }
 */
function ask(catalogRaw, history, customerMessage) {
  if (CLAUDE_MODE === 'api') {
    return askViaApi(catalogRaw, history, customerMessage);
  }
  return askViaCli(catalogRaw, history, customerMessage);
}

module.exports = { ask };
