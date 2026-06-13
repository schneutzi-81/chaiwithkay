// writing.js — the "write it" skill.
// Shapes a Hindi phrase with HarfBuzz (correct Devanagari conjuncts + matra
// reordering), turns the shaped glyphs into one SVG outline, and traces that
// outline slowly so you can copy the letterforms onto paper.
//
// HarfBuzz is wasm and ~0.4 MB, so it's loaded lazily the first time the panel
// opens (see ensureShaper). The font URL below is just a string until then.

import fontUrl from "./assets/fonts/NotoSansDevanagari-Regular.ttf?url";

const SVG_NS = "http://www.w3.org/2000/svg";

let hb = null; // the harfbuzzjs module (lazy)
let face = null;
let font = null;
let buf = null;
let ascender = 0;
let descender = 0;

// Drawing speed in milliseconds per font unit of path length. Higher = slower.
// Tuned so a typical word takes a handful of seconds at the default.
let msPerUnit = 1.6;

// State for replay / redraw.
let lastInk = null; // the animated <path>
let lastText = "";

export function prefersReducedMotion() {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

export function setSpeed(value) {
  if (Number.isFinite(value) && value > 0) msPerUnit = value;
}

// Load HarfBuzz + the font once. Safe to call repeatedly.
export async function ensureShaper() {
  if (font) return;
  hb = await import("harfbuzzjs");
  const data = await fetch(fontUrl).then((r) => r.arrayBuffer());
  const blob = new hb.Blob(data);
  face = new hb.Face(blob, 0);
  font = new hb.Font(face);
  buf = new hb.Buffer();
  const ext = font.hExtents();
  ascender = ext.ascender;
  descender = ext.descender;
}

export function isShaperReady() {
  return Boolean(font);
}

/* ---------- shaping → SVG outline ---------- */

function shapeText(text) {
  buf.clearContents();
  buf.addText(text);
  buf.guessSegmentProperties(); // script=Devanagari, lang, direction from the text
  hb.shape(font, buf);
  return buf.getGlyphInfosAndPositions();
}

// Offset one glyph's path commands by (dx, dy) and append to the running `d`.
// Fonts only emit M / L / Q / C / Z, all absolute, in y-up font units.
function appendCommands(cmds, dx, dy) {
  let d = "";
  for (const c of cmds) {
    const v = c.values;
    switch (c.type) {
      case "M":
      case "L":
        d += `${c.type}${v[0] + dx} ${v[1] + dy}`;
        break;
      case "Q":
        d += `Q${v[0] + dx} ${v[1] + dy} ${v[2] + dx} ${v[3] + dy}`;
        break;
      case "C":
        d += `C${v[0] + dx} ${v[1] + dy} ${v[2] + dx} ${v[3] + dy} ${v[4] + dx} ${v[5] + dy}`;
        break;
      case "Z":
        d += "Z";
        break;
    }
  }
  return d;
}

// Walk the shaped glyphs left→right, advancing the pen, into one outline path.
function buildOutline(text) {
  const glyphs = shapeText(text);
  let penX = 0;
  let penY = 0;
  let d = "";
  for (const g of glyphs) {
    d += appendCommands(font.glyphToJson(g.codepoint), penX + (g.xOffset || 0), penY + (g.yOffset || 0));
    penX += g.xAdvance || 0;
    penY += g.yAdvance || 0;
  }
  return { d, width: penX };
}

/* ---------- rendering + animation ---------- */

// Draw `text` into `stage`, then animate it being written. No-op until the
// shaper is ready (ensureShaper resolves before the panel ever opens).
export function drawPhrase(stage, text) {
  if (!font) return;
  lastText = text;
  const { d, width } = buildOutline(text);

  const pad = 70;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "write-trace");
  // Font space is y-up; flip it for the screen. viewBox covers the flipped box.
  svg.setAttribute("viewBox", `${-pad} ${-ascender - pad} ${width + pad * 2} ${ascender - descender + pad * 2}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Writing guide for ${text}`);

  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("transform", "scale(1,-1)");

  const ghost = document.createElementNS(SVG_NS, "path");
  ghost.setAttribute("class", "ghost");
  ghost.setAttribute("d", d);

  const ink = document.createElementNS(SVG_NS, "path");
  ink.setAttribute("class", "ink");
  ink.setAttribute("d", d);

  g.append(ghost, ink);
  svg.append(g);
  stage.replaceChildren(svg);

  lastInk = ink;
  animate(ink);
}

// Re-run the draw animation on the current phrase.
export function replay() {
  if (lastInk) animate(lastInk);
}

function animate(ink) {
  const len = ink.getTotalLength();

  if (prefersReducedMotion()) {
    ink.style.transition = "none";
    ink.style.strokeDasharray = "none";
    ink.style.strokeDashoffset = "0";
    return;
  }

  const duration = Math.min(30000, Math.max(800, len * msPerUnit));
  ink.style.transition = "none";
  ink.style.strokeDasharray = `${len}`;
  ink.style.strokeDashoffset = `${len}`;
  ink.getBoundingClientRect(); // force a reflow so the next change animates
  ink.style.transition = `stroke-dashoffset ${duration}ms linear`;
  ink.style.strokeDashoffset = "0";
}
