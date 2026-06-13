// ui.js — renders the practice card and wires up every interaction.
import {
  speak,
  isSpeechSupported,
  isRecognitionSupported,
  recognizeOnce,
  score,
  isRecordingSupported,
  startRecording,
  stopRecording,
} from "./speech.js";
import {
  getSettings,
  setSetting,
  isKnown,
  toggleKnown,
  knownCount,
  touchStreak,
  getStreak,
} from "./storage.js";

let deck = []; // active list of phrases (after filtering)
let all = []; // every phrase
let idx = 0; // current card index
let revealed = false; // is the English meaning shown?

const $ = (sel) => document.querySelector(sel);

export function init(phrases) {
  all = phrases;
  deck = [...phrases];
  buildCategoryFilter();
  renderStreak();
  render();
  wireGlobalControls();
}

/* ---------- rendering ---------- */

function current() {
  return deck[idx];
}

function render() {
  const p = current();
  if (!p) return;
  revealed = false;

  const showT = getSettings().showTranslit;

  $("#card").innerHTML = `
    <div class="card__cat">${p.cat}</div>
    <div class="card__hi" lang="hi">${p.hi}</div>
    <div class="card__translit" data-on="${showT}">${p.translit}</div>
    <button class="card__reveal" id="reveal">Tap to reveal meaning</button>
    <div class="card__en" hidden>${p.en}</div>
  `;

  $("#reveal").addEventListener("click", () => {
    revealed = !revealed;
    $(".card__en").hidden = !revealed;
    $("#reveal").textContent = revealed ? p.en : "Tap to reveal meaning";
    $("#reveal").classList.toggle("is-open", revealed);
  });

  $("#known").classList.toggle("is-on", isKnown(p.id));
  $("#position").textContent = `${idx + 1} / ${deck.length}`;
  setFeedback("");
}

function renderStreak() {
  $("#streak").textContent = `${getStreak()}🔥`;
  $("#progress").textContent = `${knownCount()} learned`;
}

function setFeedback(text, kind = "") {
  const el = $("#feedback");
  el.textContent = text;
  el.className = "feedback" + (kind ? ` is-${kind}` : "");
}

/* ---------- listening ---------- */

async function onListen(rate) {
  if (!isSpeechSupported()) {
    setFeedback("Listening isn't supported in this browser.", "off");
    return;
  }
  $("#listen").classList.add("is-active");
  await speak(current().hi, { rate });
  $("#listen").classList.remove("is-active");
}

/* ---------- speaking ---------- */

async function onSpeak() {
  const p = current();
  touchStreak();
  renderStreak();

  if (isRecognitionSupported()) {
    setFeedback("Listening… say it now", "live");
    $("#speak").classList.add("is-active");
    try {
      const alts = await recognizeOnce();
      const result = score(p.hi, alts);
      if (result === "match") setFeedback("Perfect! ✓", "match");
      else if (result === "close") setFeedback(`Close — heard “${alts[0]}”`, "close");
      else setFeedback(`Not quite — heard “${alts[0]}”. Try again.`, "off");
    } catch (err) {
      setFeedback("Didn't catch that — try again.", "off");
    } finally {
      $("#speak").classList.remove("is-active");
    }
    return;
  }

  // Fallback: record + play back so you can compare to the model voice.
  if (isRecordingSupported()) {
    await runRecordFallback();
  } else {
    setFeedback("Speaking check needs mic access (try Chrome).", "off");
  }
}

async function runRecordFallback() {
  setFeedback("Recording… tap mic again to stop", "live");
  const speakBtn = $("#speak");
  speakBtn.classList.add("is-active");
  try {
    await startRecording();
    await new Promise((res) => {
      const stop = () => {
        speakBtn.removeEventListener("click", stop);
        res();
      };
      speakBtn.addEventListener("click", stop);
    });
    const url = await stopRecording();
    speakBtn.classList.remove("is-active");
    if (url) {
      setFeedback("Here's you — compare with the 🔊 model.", "close");
      new Audio(url).play();
    }
  } catch {
    speakBtn.classList.remove("is-active");
    setFeedback("Mic permission needed for speaking practice.", "off");
  }
}

/* ---------- navigation ---------- */

function go(delta) {
  idx = (idx + delta + deck.length) % deck.length;
  render();
}

function shuffle() {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  idx = 0;
  render();
}

/* ---------- controls ---------- */

function buildCategoryFilter() {
  const cats = ["All", ...new Set(all.map((p) => p.cat))];
  $("#filter").innerHTML = cats
    .map((c) => `<option value="${c}">${c}</option>`)
    .join("");
  $("#filter").addEventListener("change", (e) => {
    const c = e.target.value;
    deck = c === "All" ? [...all] : all.filter((p) => p.cat === c);
    idx = 0;
    render();
  });
}

function wireGlobalControls() {
  $("#listen").addEventListener("click", () => onListen(0.9));
  $("#listen-slow").addEventListener("click", () => onListen(0.55));
  $("#speak").addEventListener("click", onSpeak);
  $("#prev").addEventListener("click", () => go(-1));
  $("#next").addEventListener("click", () => go(1));
  $("#shuffle").addEventListener("click", shuffle);

  $("#known").addEventListener("click", () => {
    const on = toggleKnown(current().id);
    $("#known").classList.toggle("is-on", on);
    renderStreak();
  });

  const tog = $("#toggle-translit");
  tog.checked = getSettings().showTranslit;
  tog.addEventListener("change", (e) => {
    setSetting("showTranslit", e.target.checked);
    $(".card__translit").dataset.on = e.target.checked;
  });

  // keyboard: ← → to move, space to listen
  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") go(1);
    if (e.key === "ArrowLeft") go(-1);
    if (e.key === " ") { e.preventDefault(); onListen(0.9); }
  });
}
