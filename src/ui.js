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
import {
  ensureShaper,
  isShaperReady,
  drawPhrase,
  replay,
  setSpeed,
} from "./writing.js";

let deck = []; // active list of phrases (after filtering)
let all = []; // every phrase
let idx = 0; // current card index
let revealed = false; // is the English meaning shown?
let curLevel = "All"; // active CEFR level filter
let curCat = "All"; // active category filter
let writeOpen = false; // is the writing panel expanded?
let photoUrl = null; // object URL of the user's handwriting photo

const $ = (sel) => document.querySelector(sel);

export function init(phrases) {
  all = phrases;
  deck = [...phrases];
  buildLevelFilter();
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

  // Keep the writing guide in sync with the current card.
  if (writeOpen && isShaperReady()) {
    drawPhrase($("#write-stage"), p.hi);
    $("#compare-model").textContent = p.hi;
    clearPhoto(); // the photo was for the previous card
  }
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

/* ---------- writing ---------- */

async function toggleWriting() {
  writeOpen = !writeOpen;
  $("#write-panel").hidden = !writeOpen;
  $("#write-toggle").setAttribute("aria-expanded", String(writeOpen));
  $("#write-toggle").classList.toggle("is-on", writeOpen);
  if (!writeOpen) return;

  touchStreak();
  renderStreak();

  const stage = $("#write-stage");
  if (isShaperReady()) {
    drawPhrase(stage, current().hi);
    $("#compare-model").textContent = current().hi;
    return;
  }

  stage.textContent = "Preparing the strokes…";
  try {
    await ensureShaper();
    if (!writeOpen) return; // closed again while loading
    drawPhrase(stage, current().hi);
    $("#compare-model").textContent = current().hi;
  } catch {
    stage.textContent = "Couldn't load the writing guide in this browser.";
  }
}

function onPhoto(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (photoUrl) URL.revokeObjectURL(photoUrl);
  photoUrl = URL.createObjectURL(file);
  $("#compare-photo").src = photoUrl;
  $("#compare-model").textContent = current().hi;
  $("#write-compare-view").hidden = false;
  $("#write-retake").hidden = false;
}

function clearPhoto() {
  if (photoUrl) {
    URL.revokeObjectURL(photoUrl);
    photoUrl = null;
  }
  $("#compare-photo").removeAttribute("src");
  $("#write-compare-view").hidden = true;
  $("#write-retake").hidden = true;
  $("#write-photo").value = "";
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

function buildLevelFilter() {
  const levels = ["All", ...new Set(all.map((p) => p.level))];
  $("#level-filter").innerHTML = levels
    .map((l) => `<option value="${l}">${l === "All" ? "All levels" : l}</option>`)
    .join("");
  $("#level-filter").addEventListener("change", (e) => {
    curLevel = e.target.value;
    curCat = "All"; // categories are level-specific; reset on level change
    buildCategoryFilter();
    applyFilter();
  });
}

// Category options reflect the active level so you never pick an empty combo.
function buildCategoryFilter() {
  const inLevel = curLevel === "All" ? all : all.filter((p) => p.level === curLevel);
  const cats = ["All", ...new Set(inLevel.map((p) => p.cat))];
  $("#filter").innerHTML = cats
    .map((c) => `<option value="${c}">${c === "All" ? "All topics" : c}</option>`)
    .join("");
  $("#filter").value = curCat;
  $("#filter").onchange = (e) => {
    curCat = e.target.value;
    applyFilter();
  };
}

function applyFilter() {
  deck = all.filter(
    (p) =>
      (curLevel === "All" || p.level === curLevel) &&
      (curCat === "All" || p.cat === curCat)
  );
  idx = 0;
  render();
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

  // writing practice
  $("#write-toggle").addEventListener("click", toggleWriting);
  $("#write-replay").addEventListener("click", replay);

  // Slider reads left→right as slow→fast (🐢→🐇), but the engine wants
  // ms-per-unit where *higher* is slower — so invert across the 0.4..4 range.
  const paceToMs = (pace) => 4.4 - pace;
  const speed = $("#write-speed");
  speed.value = getSettings().writeSpeed ?? 2.8;
  setSpeed(paceToMs(Number(speed.value)));
  speed.addEventListener("input", (e) => {
    const pace = Number(e.target.value);
    setSetting("writeSpeed", pace);
    setSpeed(paceToMs(pace));
  });

  const photo = $("#write-photo");
  $("#write-photo-btn").addEventListener("click", () => photo.click());
  photo.addEventListener("change", onPhoto);
  $("#write-retake").addEventListener("click", clearPhoto);

  // keyboard: ← → to move, space to listen
  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") go(1);
    if (e.key === "ArrowLeft") go(-1);
    if (e.key === " ") { e.preventDefault(); onListen(0.9); }
  });
}
