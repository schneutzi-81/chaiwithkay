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
  getTodaySession,
  saveTodaySession,
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
let sessionMode = false; // are we in today's focused session?
let sessionDone = false; // did the current session finish?

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

  const { showTranslit: showT, showGrammar: showG = false } = getSettings();

  $("#card").innerHTML = `
    <div class="card__cat">${p.cat}${sessionMode ? ` · ${idx + 1}/${deck.length}` : ""}</div>
    <div class="card__hi" lang="hi">${p.hi}</div>
    <div class="card__translit" data-on="${showT}">${p.translit}</div>
    ${p.grammar ? `<div class="card__grammar" data-on="${showG}">${p.grammar}</div>` : ""}
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
  if (sessionMode && delta > 0 && idx === deck.length - 1) {
    endSession();
    return;
  }
  idx = (idx + delta + deck.length) % deck.length;
  render();
}

function startSession() {
  // Pick up to 10 cards: unknown first, then supplement with known ones.
  let ids = getTodaySession();
  if (!ids) {
    const unknown = all.filter((p) => !isKnown(p.id));
    const known = all.filter((p) => isKnown(p.id));
    const pick = (arr, n) => [...arr].sort(() => Math.random() - 0.5).slice(0, n);
    const chosen = pick(unknown, 10);
    if (chosen.length < 10) chosen.push(...pick(known, 10 - chosen.length));
    ids = chosen.map((p) => p.id);
    saveTodaySession(ids);
  }
  const idSet = new Set(ids);
  deck = ids.map((id) => all.find((p) => p.id === id)).filter(Boolean);
  sessionMode = true;
  sessionDone = false;
  idx = 0;
  $("#session-done-card")?.remove();
  updateSessionButton();
  render();
  touchStreak();
  renderStreak();
}

function endSession() {
  sessionDone = true;
  $("#card").innerHTML = `
    <div class="session-done__title">Session done! ☕</div>
    <p class="session-done__sub">Great work — 15 minutes well spent.<br>Come back tomorrow to keep your streak.</p>
    <button class="session-done__exit" id="session-exit">← Back to all cards</button>
  `;
  setFeedback("");
  $("#position").textContent = `${deck.length} / ${deck.length}`;
  $("#session-exit").addEventListener("click", exitSession);
}

function exitSession() {
  sessionMode = false;
  sessionDone = false;
  deck = all.filter(
    (p) =>
      (curLevel === "All" || p.level === curLevel) &&
      (curCat === "All" || p.cat === curCat)
  );
  idx = 0;
  updateSessionButton();
  render();
}

function updateSessionButton() {
  $("#session-start").classList.toggle("is-on", sessionMode);
  $("#session-start").textContent = sessionMode ? "✕ Exit session" : "☕ Today's 10";
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

  const togG = $("#toggle-grammar");
  togG.checked = getSettings().showGrammar ?? false;
  togG.addEventListener("change", (e) => {
    setSetting("showGrammar", e.target.checked);
    const pill = $(".card__grammar");
    if (pill) pill.dataset.on = e.target.checked;
  });

  // quick-filter chips
  document.querySelectorAll(".qf[data-level]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (sessionMode) exitSession();
      curLevel = btn.dataset.level;
      curCat = btn.dataset.cat;
      // sync the dropdowns
      $("#level-filter").value = curLevel;
      buildCategoryFilter();
      applyFilter();
      // highlight active chip
      document.querySelectorAll(".qf[data-level]").forEach((b) =>
        b.classList.toggle("is-on", b === btn)
      );
    });
  });

  $("#session-start").addEventListener("click", () => {
    if (sessionMode) exitSession();
    else startSession();
    // clear quick-filter chip highlights when entering session
    document.querySelectorAll(".qf[data-level]").forEach((b) => b.classList.remove("is-on"));
  });

  // writing practice
  $("#write-toggle").addEventListener("click", toggleWriting);
  $("#write-replay").addEventListener("click", replay);

  // Slider reads left→right as slow→fast (🐢→🐇), but the engine wants
  // ms-per-pixel where *higher* is slower — so invert across the 0.4..4 range.
  // The ×5 scales it to the skeleton's pixel lengths (default pace ≈ 8 ms/px).
  const paceToMs = (pace) => (4.4 - pace) * 5;
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
