# Chai with Kay ☕

A personal Hindi-learning PWA. Every phrase exercises four skills on one card:
**read** it (Devanagari + optional transliteration), **hear** it (text-to-speech),
**say** it (the mic checks you), and **write** it (the script draws slowly so you
can copy it onto paper). Sessions are short — a cup of chai, not a textbook.

No backend, no accounts, no cost. Everything runs in the browser.

## Run it locally

```bash
npm install
npm run dev
```

Open the printed `localhost` URL. For the **Speak** feature you need `localhost`
or HTTPS (browsers block mic access otherwise) — `npm run dev` already serves on
localhost, so you're fine.

## Build & preview

```bash
npm run build      # outputs to dist/
npm run preview    # serve the production build
```

## Deploy (GitHub Pages)

A workflow at `.github/workflows/deploy.yml` builds and publishes on every push to
`main`. One-time setup: in your repo, **Settings → Pages → Source → GitHub Actions**.
After that, pushing to `main` ships it to `https://<you>.github.io/chaiwithkay/`.

> If your repo isn't named `chaiwithkay`, update `base`, `start_url`, and `scope`
> in `vite.config.js` to match.

## Content: an A1–A2 syllabus

The deck is organised as a CEFR **A1–A2** beginner syllabus — ~140 phrases across
20 topic units (10 A1, 10 A2), from greetings and numbers up to daily routine,
directions, and shopping. Filter by **level** (A1 / A2) and by **topic**; the topic
list narrows to whatever's in the selected level.

## Add your own phrases

Edit `src/data/phrases.json`. Each entry:

```json
{ "id": "a1-greet-01", "level": "A1", "cat": "Greetings", "hi": "नमस्ते", "translit": "namaste", "en": "Hello / Goodbye" }
```

- `level` is `"A1"` or `"A2"` — it feeds the level filter.
- `cat` is the topic unit — it appears in the category filter (scoped to the level).
- `id` must be unique (progress/streak are keyed on it).

That's the whole content model.

## Browser support

| Feature | Chrome / Edge | Android | iOS Safari |
|---|---|---|---|
| Listen (TTS) | ✅ | ✅ | ✅ |
| Speak — recognition | ✅ | ✅ | ⚠️ falls back |
| Write — trace + photo compare | ✅ | ✅ | ✅ |

Where speech **recognition** isn't available (notably iOS), Speak switches to a
record-and-play-back mode: you record your attempt and compare it to the model
voice. Listening always works.

## Write it

Tap **✍️ Write it** and the current phrase's Devanagari is traced slowly, stroke by
stroke, so you can copy the letterforms onto paper. A 🐢→🐇 slider sets the pace
(it remembers your choice) and **↻ Replay** redraws. Then snap or upload a photo of
your handwriting to see it **side-by-side** with the model script and judge it
yourself — there's no automatic grading, and nothing is uploaded or stored.

The trace is real: the phrase is shaped with **HarfBuzz** (wasm) so Devanagari
conjuncts and matra reordering come out correct, and the shaped glyph outlines are
animated as an SVG stroke. HarfBuzz and a bundled **Noto Sans Devanagari** font load
lazily the first time you open the panel, and both are precached for offline use.

## Layout

```
src/
  main.js          boot + PWA registration
  ui.js            render the card, wire interactions
  speech.js        TTS + recognition + record fallback
  writing.js       HarfBuzz shaping → SVG stroke trace (the "write it" skill)
  storage.js       streak / learned / settings (localStorage)
  styles.css       the warm evening-chai theme
  assets/fonts/    bundled Noto Sans Devanagari (offline + shaper input)
  data/phrases.json
```

See `PLAN.md` for scope and roadmap.
