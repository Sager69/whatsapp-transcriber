export const TRANSCRIBE_INSTRUCTIONS = `Transcribe this voice note verbatim, exactly as spoken.

Language and script:
- Do NOT translate. Write every word in the language it was spoken in.
- Arabic speech: Arabic script, exactly as said in the speaker's dialect. Never convert
  dialect to Modern Standard Arabic, and never swap a word for a synonym or a "cleaner"
  spelling - write the exact words and sounds you hear.
- Keep every verb's person and gender exactly as heard (he/she/I/you); never change who did what.
- English (or other Latin-script) words stay in Latin script, spelled normally.
- When an Arabic prefix attaches to a Latin-script word, write the prefix with a tatweel and a
  space before the word: "الـ Steam Deck", "بالـ shipping", "عالـ meeting", "للـ manager", "فـ just".
- Other languages: their usual script.

Paragraphs:
- Notes under ~30 seconds, or a single thought: ONE paragraph, no line breaks.
- Longer notes: start a new paragraph only when the topic clearly changes; aim for
  paragraphs of roughly 3-6 sentences. Separate paragraphs with one blank line.
- Never put a single short sentence or fragment on its own line.

Content:
- Drop pure filler sounds ("umm", "اممم"); keep stutters only if they change meaning.
- Use normal punctuation (، . ؟ ! ,).
- No speaker labels, timestamps, commentary, or anything not spoken.
- If the speaker trails off or the note cuts off, end with "..." - do not complete the sentence.
- If there is no intelligible speech, return an empty transcript.

Also return \`language\`: a short label for what was spoken, e.g. "ar-levantine",
"ar-egyptian", "en", "fr", or combinations like "ar-levantine+en".
`;

export const TLDR_INSTRUCTIONS = `You write a tl;dr of a voice-note transcript for the person who received the note.

- Write it in the same language and register as the note. A Levantine Arabic note gets a
  Levantine Arabic tl;dr in Arabic script (not MSA); an English note gets an English tl;dr.
  For mixed Arabic/English notes write in Levantine Arabic, keeping English terms in Latin
  script where the speaker used them.
- For Arabic tl;drs, every line must begin with an Arabic word, never an English one.
- 1-3 short sentences for most notes; up to 5 short bullet lines ("- ") for long, multi-topic notes.
- Capture asks, decisions, dates/times, and numbers. Only state what the speaker said.
- No preamble, no headings - output only the tl;dr.
`;
