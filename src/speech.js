// speech.js — everything that talks or listens.
// Three jobs: speak Hindi aloud (TTS), check what you said (STT),
// and a record-and-playback fallback for browsers without STT (hi, iPhone).

const HI = "hi-IN";

/* ---------- Listening: text-to-speech ---------- */

let voicesReady = false;
let hindiVoice = null;

function pickHindiVoice() {
  const voices = window.speechSynthesis?.getVoices?.() ?? [];
  // Prefer an explicit hi-IN voice; fall back to anything starting with "hi".
  hindiVoice =
    voices.find((v) => v.lang === HI) ||
    voices.find((v) => v.lang?.toLowerCase().startsWith("hi")) ||
    null;
  voicesReady = voices.length > 0;
}

// Voices load asynchronously in most browsers — listen for them.
if ("speechSynthesis" in window) {
  pickHindiVoice();
  window.speechSynthesis.onvoiceschanged = pickHindiVoice;
}

export function isSpeechSupported() {
  return "speechSynthesis" in window;
}

export function hasHindiVoice() {
  pickHindiVoice();
  return Boolean(hindiVoice);
}

// Speak a phrase. rate < 1 is slower (good for learners).
export function speak(text, { rate = 0.9 } = {}) {
  if (!isSpeechSupported()) return Promise.resolve(false);
  return new Promise((resolve) => {
    window.speechSynthesis.cancel(); // stop anything mid-sentence
    const u = new SpeechSynthesisUtterance(text);
    u.lang = HI;
    u.rate = rate;
    if (hindiVoice) u.voice = hindiVoice;
    u.onend = () => resolve(true);
    u.onerror = () => resolve(false);
    window.speechSynthesis.speak(u);
  });
}

/* ---------- Speaking: speech recognition ---------- */

const Recognition =
  window.SpeechRecognition || window.webkitSpeechRecognition || null;

export function isRecognitionSupported() {
  return Boolean(Recognition);
}

// Listen once and return the transcript. Rejects on error/no-speech.
export function recognizeOnce() {
  return new Promise((resolve, reject) => {
    if (!Recognition) return reject(new Error("unsupported"));
    const rec = new Recognition();
    rec.lang = HI;
    rec.interimResults = false;
    rec.maxAlternatives = 3;
    rec.onresult = (ev) => {
      const alts = Array.from(ev.results[0]).map((a) => a.transcript);
      resolve(alts);
    };
    rec.onerror = (ev) => reject(new Error(ev.error || "error"));
    rec.onend = () => {}; // resolve happens in onresult
    rec.start();
  });
}

// Compare what you said against the target. Returns "match" | "close" | "off".
// We strip punctuation/spaces and the trailing maatra differences are forgiven
// loosely via a character-overlap ratio.
export function score(target, spokenAlternatives) {
  const clean = (s) =>
    (s || "").replace(/[।?!.,\s]/g, "").normalize("NFC");
  const t = clean(target);
  for (const alt of spokenAlternatives) {
    const a = clean(alt);
    if (a === t) return "match";
  }
  // best fuzzy overlap across alternatives
  let best = 0;
  for (const alt of spokenAlternatives) {
    const a = clean(alt);
    const overlap = ratio(t, a);
    if (overlap > best) best = overlap;
  }
  if (best >= 0.6) return "close";
  return "off";
}

// crude similarity: shared characters / longest string
function ratio(a, b) {
  if (!a || !b) return 0;
  const setB = new Set(b);
  let shared = 0;
  for (const ch of a) if (setB.has(ch)) shared++;
  return shared / Math.max(a.length, b.length);
}

/* ---------- Fallback: record yourself and play it back ---------- */
// For browsers without SpeechRecognition. You hear the model voice,
// record your attempt, then hear yourself to self-correct.

let mediaRecorder = null;
let chunks = [];

export function isRecordingSupported() {
  return Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
}

export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  chunks = [];
  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
  mediaRecorder.start();
}

export function stopRecording() {
  return new Promise((resolve) => {
    if (!mediaRecorder) return resolve(null);
    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: "audio/webm" });
      mediaRecorder.stream.getTracks().forEach((t) => t.stop());
      mediaRecorder = null;
      resolve(URL.createObjectURL(blob));
    };
    mediaRecorder.stop();
  });
}
