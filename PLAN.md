# Plan — Chai with Kay

## Goal
A personal PWA for learning Hindi as a beginner, focused on **speaking, reading,
and listening**. Daily, low-friction practice — short sessions, no setup ceremony.

## Principles
- One card = all three skills. No mode-switching to practise reading vs listening.
- Browser-native speech (free, offline-friendly). No paid APIs, no backend.
- Content is plain JSON — growing the deck never means touching app code.

## Decisions
| Choice | Why |
|---|---|
| Vite + vanilla JS | Fast, no framework tax; easy to extend with Preact later. |
| vite-plugin-pwa | Manifest + service worker + offline without hand-rolling. |
| Web Speech API | TTS + recognition built into the browser, zero cost. |
| GitHub Pages | Free HTTPS (needed for mic) + lives with the repo. |
| localStorage | Streak/progress without a database. |

## Scope — v0.1 (this build)
- [x] ~30 beginner phrases across 5 categories
- [x] Card: big Devanagari, transliteration toggle, tap-to-reveal meaning
- [x] Listen at normal + slow speed
- [x] Speak with recognition; record-and-compare fallback
- [x] Prev / next / shuffle / category filter
- [x] Streak + "got it" marking
- [x] Installable PWA, offline-capable
- [x] Keyboard nav, reduced-motion, visible focus

## Content — A1–A2 syllabus
The deck follows a CEFR-style **A1–A2** progression. Each phrase carries a `level`
(`A1`/`A2`) alongside its topic `cat`, and the UI filters by both (the topic list
is scoped to the chosen level). ~140 phrases across 20 units:
- **A1 (10 units):** Greetings · Introductions · Courtesy · Numbers · Family ·
  Questions · Days & Time · Food & Drink · Colours · Everyday Actions
- **A2 (10 units):** Daily Routine · Shopping & Money · Directions & Places ·
  Travel & Transport · Weather · Health & Body · Restaurant · Past & Future ·
  Feelings & Opinions · Describing Things

Next content step: deepen each unit toward the full ~1,500-word A1–A2 base.

## Roadmap
- **v0.2 — Spaced repetition.** Reviews target weak/unknown phrases instead of
  linear order. Store per-card ease + due date.
- **v0.3 — Quizzes.** Listening quiz (hear → pick meaning); reading quiz
  (script → recall meaning, self-graded).
- **v0.4 — Devanagari drills.** Letter-by-letter script recognition.
- **v0.5 — Stats.** Practice calendar, accuracy trends, per-category progress.

## Known risks
- **iOS speech recognition** is unreliable/absent → handled via the record-and-
  play-back fallback. Revisit if Apple ships proper support.
- **TTS voice quality** varies by device/OS. The app picks the best available
  `hi-IN` voice; some platforms sound robotic. A cloud TTS could be a later option.
- **Recognition scoring is fuzzy** (character overlap). Good enough for "did I say
  roughly the right thing"; not a pronunciation grader.

## Milestones
M0 scaffold · M1 card UI + content · M2 listening · M3 speaking + fallback ·
M4 progress + PWA/offline · M5 spaced repetition
