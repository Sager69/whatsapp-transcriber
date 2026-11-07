# Bake-off (local only)

Everything in this folder except this README is git-ignored: it holds private voice notes.

- `samples/` — `.opus`/`.ogg` voice notes
- `answers.local.json` — optional owner-verified phrases, e.g.
  `{"note.opus": {"contains": ["خلاص done", "بكرة"]}, "other.opus": {"start": "انا عارف"}}`

Run (keys from your shell environment):

    GEMINI_API_KEY=... CO_API_KEY=... npm run score

It runs each note through the real pipeline (fake WhatsApp), prints the replies the bot would
send, and scores them against the answer key.
