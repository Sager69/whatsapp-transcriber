# WhatsApp Voice-Note Transcriber

Forward a voice note to the bot's WhatsApp number and it replies, quoting the note, with a verbatim
transcript in whatever language(s) were spoken. Built for Levantine Arabic and Levantine/English
code-switching: dialect is kept as spoken (not converted to Modern Standard Arabic) and English words
stay in Latin script.

- Notes **longer than 60s** get a tl;dr in the note's language at the end of the transcript.
- Notes **shorter than 8s** get a second opinion from a different speech-to-text system. If the two
  disagree, the reply starts with `⚠️ unclear audio`, since very short clips are where transcription
  tends to invent text.
- Arabic/mixed paragraphs that would start with an English word get an invisible right-to-left mark
  (U+200F), so WhatsApp lays them out right-to-left.
- Replies come back **in the order the notes were sent**, even when a short note finishes before a long one.
- Only allowlisted numbers are served; everyone else is ignored.
- Audio is processed in memory and never stored. Transcripts are not stored: the Workflow state that
  Cloudflare keeps for a few days is AES-GCM encrypted with a key derived from `WA_APP_SECRET`.

## How it works

Everything runs on Cloudflare (the Workers free plan is enough):

```
WhatsApp Cloud API ──POST /webhook──▶ Worker
                                       verify Meta's signature, check the allowlist,
                                       give the message its place in the sender's queue,
                                       start a Workflow named after the message id → 200
                                       (a redelivered message maps to the same Workflow, so it's ignored)

                     Workflow (each step retried and checkpointed)
                       react ⏳ → download audio → read its length from the Ogg container
                       → Gemini transcript (+ Cohere second opinion if < 8s)
                       → tl;dr if > 60s → hand the reply to the sender's outbox

                     Outbox (one Durable Object per sender)
                       sends replies strictly in arrival order → react ✅ (or ❌ + apology);
                       a note stuck for 5 minutes is skipped so it can't hold up the rest
```

| Piece | Choice | Where |
|---|---|---|
| Transcription | Google `gemini-3.8-flash` | `src/transcribe.ts`, prompt in `src/prompt.ts` |
| Second opinion (short notes) | Cohere Transcribe Arabic | `src/transcribe.ts` |
| tl;dr | Google `gemini-3.8-flash` | `src/prompt.ts` |
| Webhook | Cloudflare Worker | `src/handler.ts` |
| Processing | Cloudflare Workflow | `src/pipeline.ts`, `src/index.ts` |
| Reply ordering | Cloudflare Durable Object | `src/outbox.ts` |

### Costs

- **Cloudflare:** Workers free plan (100,000 requests/day; Workflows and SQLite Durable Objects included).
- **WhatsApp Cloud API:** free when people message the bot first; replies within 24 hours of their
  message are free service messages.
- **Gemini:** pay-as-you-go, billed per audio length; a fraction of a cent per minute of audio.
- **Cohere:** only short notes (< 8s) are sent. A trial key works for testing; use a production key
  for regular use.

---

# Set it up with an AI coding agent

You can hand the setup to a coding agent (Claude Code, Codex, Cursor, …) running in a terminal where
it can use `git`, `npm` and `npx wrangler`. The agent does the code, the deploy and the checks. You do
the parts that need a browser login: the Meta dashboard, creating API keys, and entering secrets.

Paste this prompt into the agent:

````text
Set up the WhatsApp voice-note transcriber from this repository for me:
<REPO URL>

Read README.md first. Its "Setup" section (Steps 1–11) is the source of truth; follow it in order.
I want the bot at this hostname on my Cloudflare domain: <e.g. transcribe.example.com>

How to work with me:
- Ask me for one thing at a time, and wait until I confirm it's done before moving on.
- Whenever I need to get a value or click something, give exact directions: the full URL to open,
  and every menu, button and field name in order. Never just say "the X token" or "your app secret"
  without telling me exactly where to find it.
- Never ask me to paste API keys, tokens or secrets into this chat. I'll enter secrets myself, either
  in the Cloudflare dashboard (Step 7) or by running `npx wrangler secret put <NAME>` in my terminal.
  Tell me the exact names to use.
- Don't push to git, force-push, or delete anything unless I ask.

What you do yourself:
- Clone the repo, run `npm install`, `npm test` and `npm run typecheck`, and fix anything that fails.
- Deploy with `npm run deploy` (have me run `npx wrangler login` first if wrangler isn't logged in).
  If the deploy says Workflows need a workers.dev subdomain, walk me through Step 5, then retry.
- Walk me through attaching the custom domain (Step 6) and check that https://<hostname>/healthz
  returns {"ok":true}.
- Before I verify the webhook in Meta (Step 8), run `npx wrangler secret list` and confirm
  WA_VERIFY_TOKEN is there.
- After I've done Steps 8–10, ask me to send a voice note from an allowlisted number, then check:
  `npx wrangler workflows instances list whatsapp-transcriber-jobs` should show a new run, and
  `npx wrangler workflows instances describe whatsapp-transcriber-jobs <id>` shows each step's result.
  If no run appears, use the README's Troubleshooting table. The usual causes are Step 9 (WhatsApp
  account not subscribed to the app) and Step 10 (app not published).

What I do (guide me through each with exact directions):
- Steps 1–4: the Gemini and Cohere keys, the Meta app and test number, the system-user token, the
  app secret and the verify token.
- Step 7: entering the secrets.
- Steps 8–10: connecting the webhook, subscribing the WhatsApp account, publishing the app.
- Step 11: test messages from my phone.

When everything works, give me a short summary: the bot's WhatsApp number, how to add a user, and
where to find the logs.
````

Replace `<REPO URL>` and the hostname before sending.

---

# Setup

You need:

- a **Cloudflare account**, with a **domain** added to it (the bot gets a hostname such as
  `transcribe.example.com`)
- a **Facebook account** (for Meta for Developers)
- **Node.js 22** or newer, and `git`
- about 45 minutes

Collect the values below as you go. Every one of them ends up in Cloudflare in Step 7.

| Name | What it is | Where you get it |
|---|---|---|
| `GEMINI_API_KEY` | Google Gemini API key | Step 1 |
| `CO_API_KEY` | Cohere API key (optional) | Step 1 |
| `WA_PHONE_NUMBER_ID` | ID of the WhatsApp number the bot uses | Step 2 |
| `ALLOWED_NUMBERS` | phone numbers allowed to use the bot | Step 2 |
| `WA_TOKEN` | permanent access token for the WhatsApp API | Step 3 |
| `WA_APP_SECRET` | secret that Meta signs webhooks with | Step 4 |
| `WA_VERIFY_TOKEN` | random string you make up | Step 4 |
| `CONTACT_EMAIL` | email shown on the privacy page (optional) | — |

## Step 1 — API keys

**Gemini**
1. Open https://aistudio.google.com/apikey and sign in with a Google account.
2. Click **Create API key**, then pick or create a Google Cloud project.
3. Copy the key → this is `GEMINI_API_KEY`.
4. Billing must be enabled on that Google Cloud project for the `gemini-3.8-flash` model.

**Cohere** (optional; without it, short notes are simply not double-checked)
1. Open https://dashboard.cohere.com/api-keys and sign up or sign in.
2. Copy the trial key, or create a production key → this is `CO_API_KEY`.

## Step 2 — Create the Meta app and get a WhatsApp number

1. Open https://developers.facebook.com/apps and sign in. If asked, register as a developer
   (verify your email and phone).
2. Click **Create app**.
   - **App name:** anything, e.g. `Voice Transcriber`.
   - **Use case:** choose **Connect with customers through WhatsApp**.
   - **Business portfolio:** pick yours, or create one when prompted.
   - Finish the wizard.
3. In the app, open **Use cases** → **Customize** (next to *Connect with customers through
   WhatsApp*) → **Step 1. Try it out**.
4. Under **Claim a WhatsApp test number**, claim the free test number. The box then shows:
   - **Phone Number ID** → this is `WA_PHONE_NUMBER_ID`
   - **Messaging account ID** → the WhatsApp Business Account ID (**WABA ID**); you need it in Step 9.
5. On the same page, click the **Recipient** dropdown → **Manage phone number list** → add the
   number of each person who will use the bot. WhatsApp sends each of them a code; enter it there.
   The test number can talk to at most **5** verified numbers.
6. Write those numbers in international format, without `+`, spaces or dashes, separated by commas:
   e.g. `447700900123,15551234567` → this is `ALLOWED_NUMBERS`.

> Need more than 5 users or a real display name? Under **Step 2. Production setup** →
> **Register your WhatsApp phone number** you can add a real number (a SIM or eSIM that is not
> registered on WhatsApp). Its Phone Number ID then replaces the test number's.

## Step 3 — Permanent access token (`WA_TOKEN`)

The token on the *Try it out* page expires after 24 hours, so create a system user instead:

1. Open https://business.facebook.com/settings → **Users** → **System users**.
2. Click **Add**. Name: `transcriber-bot`. Role: **Admin**. Click **Create system user**.
3. With the new user selected, click **Assign assets**:
   - **Apps** → tick your app → turn on **Full control** → **Save changes**.
   - Click **Assign assets** again → **WhatsApp accounts** → tick your account → **Full control** →
     **Save changes**.
4. Click **Generate new token**:
   - **App:** your app
   - **Token expiration:** **Never**
   - **Permissions:** tick `whatsapp_business_messaging` and `whatsapp_business_management`
   - Click **Generate token**, then **Copy** → this is `WA_TOKEN`. It is shown only once.

## Step 4 — App secret and verify token

1. Open https://developers.facebook.com/apps → your app → **App settings** → **Basic**.
2. Next to **App secret**, click **Show**, enter your Facebook password, and copy it → this is
   `WA_APP_SECRET`.
3. Make up a random string for `WA_VERIFY_TOKEN`, for example with:
   ```bash
   openssl rand -hex 16
   ```

## Step 5 — Cloudflare: enable Workers

Workflows require your account to have a `workers.dev` subdomain (the bot itself won't be served
there).

1. Open https://dash.cloudflare.com → **Workers & Pages**.
2. If it shows an onboarding screen, follow it until it shows your subdomain
   (`<something>.workers.dev`). If it already lists Workers, you have one.

## Step 6 — Deploy the Worker

```bash
git clone <this repo>
cd whatsapp-transcriber
npm install
npx wrangler login
npm run deploy
```

`wrangler login` opens a browser to authorize your Cloudflare account. On a machine without a
browser, create a token instead: https://dash.cloudflare.com/profile/api-tokens → **Create Token** →
template **Edit Cloudflare Workers** → select your account and your domain's zone → create, then
`export CLOUDFLARE_API_TOKEN=<token>` before `npm run deploy`.

The deploy prints `workflow: whatsapp-transcriber-jobs` when it worked.

**Give it a hostname:**
1. dash.cloudflare.com → **Workers & Pages** → `whatsapp-transcriber` → **Settings** →
   **Domains & Routes** → **Add** → **Custom domain**.
2. Enter e.g. `transcribe.example.com` (a hostname on your domain that isn't used yet) → **Add domain**.
3. After a minute, open `https://transcribe.example.com/healthz` in a browser. It should show
   `{"ok":true}`.

Don't put this hostname behind Cloudflare Access or a login page — Meta can't log in. The Worker
checks Meta's signature on every request instead.

## Step 7 — Add the secrets

1. dash.cloudflare.com → **Workers & Pages** → `whatsapp-transcriber` → **Settings** →
   **Variables and Secrets**.
2. For each name in the table at the top, click **+ Add**, set **Type: Secret**, and enter the
   **Variable name** and **Value**.
3. Click **Deploy** at the bottom. Nothing is saved until you do.

Or from the terminal, one at a time (each command prompts for the value):

```bash
npx wrangler secret put WA_TOKEN
npx wrangler secret put WA_PHONE_NUMBER_ID
npx wrangler secret put WA_APP_SECRET
npx wrangler secret put WA_VERIFY_TOKEN
npx wrangler secret put ALLOWED_NUMBERS
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put CO_API_KEY
npx wrangler secret put CONTACT_EMAIL
```

Check that they're all there with `npx wrangler secret list`. (`wrangler.toml` sets `keep_vars = true`,
so values added in the dashboard as plain text also survive later deploys.)

## Step 8 — Connect the webhook

`WA_VERIFY_TOKEN` must already be saved in Cloudflare (Step 7), or verification fails.

1. developers.facebook.com → your app → **Use cases** → **Customize** → **Step 2. Production setup**
   → **Configure Webhooks**.
2. **Callback URL:** `https://transcribe.example.com/webhook`
3. **Verify token:** the same value as `WA_VERIFY_TOKEN`.
4. Click **Verify and save**.
5. In the **Webhook fields** list that appears, find **messages** and click **Subscribe**.

## Step 9 — Subscribe your WhatsApp account to the app

Verifying the webhook doesn't make Meta send messages to it. Your WhatsApp Business Account also has
to be subscribed to the app:

1. Open https://developers.facebook.com/tools/explorer/
2. In the right panel:
   - **Meta App:** your app
   - **User or Page:** **User Token**
   - **Permissions:** add `whatsapp_business_management` and `whatsapp_business_messaging`
   - Click **Generate Access Token** and approve the popup.
3. Set the method (left of the URL box) to **POST**, enter `<WABA ID>/subscribed_apps` (the
   *Messaging account ID* from Step 2.4), and click **Submit**.
4. It should answer `{"success": true}`. Switching to **GET** with the same path should now list your app.

## Step 10 — Publish the app

While the app is unpublished, Meta delivers no real messages — not even yours.

1. developers.facebook.com → your app → **App settings** → **Basic**:
   - **Privacy Policy URL:** `https://transcribe.example.com/privacy`
   - **User data deletion:** choose **Data deletion instructions URL** →
     `https://transcribe.example.com/privacy`
   - **Category:** e.g. **Utilities**
   - **App icon:** upload a square image (1024×1024) if it's empty
   - Click **Save changes**.
2. In the narrow icon bar on the far left, click **Publish** (the up-arrow icon) → **Publish**.

## Step 11 — Test it

From an allowlisted phone, send to the bot's number (the test number from Step 2.4):

1. "hi" → the help message.
2. A short voice note → ⏳ reaction, then the transcript quoting your note, then ✅.
3. A note over a minute → the transcript ending with a `باختصار:` / `tl;dr:` summary.
4. A note that starts with an English word → still laid out right-to-left.
5. From a number that isn't allowlisted → nothing happens.

---

# Running it

**Add a user:** add their number to the recipient list (Step 2.5) and to `ALLOWED_NUMBERS`
(Step 7), then click **Deploy**.

**Logs:** dash.cloudflare.com → **Workers & Pages** → `whatsapp-transcriber` → **Logs** (webhook
requests) and **Workflows** → `whatsapp-transcriber-jobs` (one run per voice note, with each step's
status and errors).

**Settings** (in `wrangler.toml` under `[vars]`, then `npm run deploy`):

| Variable | Default | Meaning |
|---|---|---|
| `GEMINI_MODEL` | `gemini-3.8-flash` | transcription model |
| `TLDR_MODEL` | `gemini-3.8-flash` | tl;dr model |
| `TLDR_MIN_SECONDS` | `60` | notes longer than this get a tl;dr |
| `CROSSCHECK_MAX_SECONDS` | `8` | notes shorter than this get a second opinion |
| `CROSSCHECK_MIN_AGREEMENT` | `0.5` | below this similarity the reply is flagged ⚠️ |
| `MAX_AUDIO_SECONDS` | `1800` | longer notes are refused |
| `GRAPH_API_VERSION` | `v25.0` | WhatsApp Graph API version |

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Deploy fails: *Workflows require your account to have a workers.dev subdomain* | Do Step 5, then deploy again. |
| *Verify and save* fails in Meta | `WA_VERIFY_TOKEN` isn't saved (or deployed) in Cloudflare, or doesn't match exactly. |
| Webhook verified, but the bot never reacts | Step 9 (subscribe the WhatsApp account) or Step 10 (publish) is missing. Meta's **Try it out** page lists received messages under **Check test webhooks** even when they aren't delivered. |
| Works for you but not for someone else | Their number is missing from the recipient list (Step 2.5) or from `ALLOWED_NUMBERS` (no `+`, no spaces). |
| ⏳ appears, then ❌ and an apology | Open the run under **Workflows** to see which step failed. A `401` from Graph means `WA_TOKEN` is wrong or expired; a Gemini `400 API key not valid` means `GEMINI_API_KEY` is wrong. |

---

# Development

```bash
npm install
npm test            # unit tests (the Ogg duration test uses ffmpeg if installed)
npm run typecheck
```

`npm run score` runs voice notes from `bakeoff/samples/` through the real pipeline (with a fake
WhatsApp) and scores them against an optional answer key — see `bakeoff/README.md`. That folder is
git-ignored apart from its README, because it holds private voice notes.
