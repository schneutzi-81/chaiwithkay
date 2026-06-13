// writing.js — the "write it" skill.
// Shapes a Hindi phrase with HarfBuzz (correct Devanagari conjuncts + matra
// reordering), then writes it the way a person would: a round pen travels down
// the *centerline* of each stroke, one stroke at a time, with brief lifts in
// between — in a handwriting face (Kalam) — so you can copy the motion on paper.
//
// Getting the centerline from an arbitrary word offline: there's no pen-stroke
// dataset, so we rasterize the shaped glyph outline, thin it to a 1px skeleton
// (Zhang–Suen), and trace that skeleton into strokes — flowing straight through
// junctions so a stem or the top headline reads as one continuous motion rather
// than a pile of tiny segments. The faint filled glyph sits underneath as the
// target to copy.
//
// HarfBuzz is wasm and ~0.4 MB, so it's loaded lazily the first time the panel
// opens (see ensureShaper). The font URL below is just a string until then.

import fontUrl from "./assets/fonts/Kalam-Regular.ttf?url";

const SVG_NS = "http://www.w3.org/2000/svg";

let hb = null; // the harfbuzzjs module (lazy)
let face = null;
let font = null;
let buf = null;
let ascender = 0;
let descender = 0;

// Drawing speed in milliseconds per pixel of pen travel. Higher = slower.
// (Stroke paths are measured in screen pixels — see drawPhrase.)
let msPerUnit = 8;

// State for replay + a token so a redraw cancels the previous stroke sequence.
let lastStrokes = null;
let seqToken = 0;

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

// Offset one glyph's path commands by (dx, dy), append to `d`, grow the bbox.
// Fonts only emit M / L / Q / C / Z, all absolute, in y-up font units.
function appendCommands(cmds, dx, dy, bbox) {
  let d = "";
  const grow = (x, y) => {
    if (x < bbox.minX) bbox.minX = x;
    if (x > bbox.maxX) bbox.maxX = x;
    if (y < bbox.minY) bbox.minY = y;
    if (y > bbox.maxY) bbox.maxY = y;
  };
  for (const c of cmds) {
    const v = c.values;
    switch (c.type) {
      case "M":
      case "L":
        grow(v[0] + dx, v[1] + dy);
        d += `${c.type}${v[0] + dx} ${v[1] + dy}`;
        break;
      case "Q":
        grow(v[0] + dx, v[1] + dy);
        grow(v[2] + dx, v[3] + dy);
        d += `Q${v[0] + dx} ${v[1] + dy} ${v[2] + dx} ${v[3] + dy}`;
        break;
      case "C":
        grow(v[0] + dx, v[1] + dy);
        grow(v[2] + dx, v[3] + dy);
        grow(v[4] + dx, v[5] + dy);
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
  const bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  let penX = 0;
  let penY = 0;
  let d = "";
  for (const g of glyphs) {
    d += appendCommands(
      font.glyphToJson(g.codepoint),
      penX + (g.xOffset || 0),
      penY + (g.yOffset || 0),
      bbox
    );
    penX += g.xAdvance || 0;
    penY += g.yAdvance || 0;
  }
  return { d, bbox };
}

/* ---------- outline → centerline skeleton ---------- */

// Fill the outline onto an offscreen canvas and return a binary grid.
// Font space is y-up; the transform flips it and fits the glyph to TARGET_H.
function rasterize(d, bbox) {
  const TARGET_H = 200; // content height in px (resolution of the trace)
  const MAX_W = 1300;
  const pad = 14;
  const bw = bbox.maxX - bbox.minX;
  const bh = bbox.maxY - bbox.minY;
  let scale = TARGET_H / bh;
  if (bw * scale > MAX_W) scale = MAX_W / bw;

  const w = Math.ceil(bw * scale) + pad * 2;
  const h = Math.ceil(bh * scale) + pad * 2;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  // (x,y) font units → (scale*(x-minX)+pad, scale*(maxY-y)+pad) device px.
  ctx.setTransform(scale, 0, 0, -scale, pad - scale * bbox.minX, pad + scale * bbox.maxY);
  ctx.fill(new Path2D(d)); // nonzero winding keeps counters (holes) open

  const alpha = ctx.getImageData(0, 0, w, h).data;
  const grid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) grid[i] = alpha[i * 4 + 3] > 96 ? 1 : 0;
  return { grid, w, h, scale, pad };
}

// Zhang–Suen thinning: erode the filled shape to a 1px-wide skeleton in place.
function thin(g, w, h) {
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : g[y * w + x]);
  const toClear = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      toClear.length = 0;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          if (!g[y * w + x]) continue;
          const p2 = at(x, y - 1), p3 = at(x + 1, y - 1), p4 = at(x + 1, y),
            p5 = at(x + 1, y + 1), p6 = at(x, y + 1), p7 = at(x - 1, y + 1),
            p8 = at(x - 1, y), p9 = at(x - 1, y - 1);
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (b < 2 || b > 6) continue;
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          let a = 0;
          for (let k = 0; k < 8; k++) if (seq[k] === 0 && seq[k + 1] === 1) a++;
          if (a !== 1) continue;
          if (step === 0) {
            if (p2 * p4 * p6) continue;
            if (p4 * p6 * p8) continue;
          } else {
            if (p2 * p4 * p8) continue;
            if (p2 * p6 * p8) continue;
          }
          toClear.push(y * w + x);
        }
      }
      if (toClear.length) {
        changed = true;
        for (const i of toClear) g[i] = 0;
      }
    }
  }
  return g;
}

const NBRS8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

// Trace a 1px skeleton into strokes. At each step we keep going along the
// neighbour that best continues the current heading — so straight runs and
// gentle curves flow *through* junctions as one stroke (like a stem or the top
// headline), and we only lift the pen at a sharp reversal or a dead end.
function trace(skel, w, h) {
  const fg = (x, y) => x >= 0 && y >= 0 && x < w && y < h && skel[y * w + x];
  const nbrs = (p) => {
    const x = p % w, y = (p - x) / w, out = [];
    for (const [dx, dy] of NBRS8) if (fg(x + dx, y + dy)) out.push((y + dy) * w + (x + dx));
    return out;
  };
  const xy = (p) => [p % w, (p - (p % w)) / w];
  const seen = new Set();
  const ek = (a, b) => (a < b ? a + "_" + b : b + "_" + a);

  // Local heading at the growing tip, smoothed over the last few points.
  const heading = (pts) => {
    const n = pts.length;
    const a = pts[Math.max(0, n - 3)];
    const b = pts[n - 1];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const m = Math.hypot(dx, dy) || 1;
    return [dx / m, dy / m];
  };

  const walk = (start, second) => {
    const pts = [xy(start), xy(second)];
    seen.add(ek(start, second));
    let prev = start, cur = second;
    for (;;) {
      const cands = nbrs(cur).filter((q) => q !== prev && !seen.has(ek(cur, q)));
      if (!cands.length) break;
      const [hx, hy] = heading(pts);
      const [cx, cy] = xy(cur);
      let best = null, bestDot = -2;
      for (const q of cands) {
        const [qx, qy] = xy(q);
        const dx = qx - cx, dy = qy - cy;
        const m = Math.hypot(dx, dy) || 1;
        const dot = (dx / m) * hx + (dy / m) * hy;
        if (dot > bestDot) { bestDot = dot; best = q; }
      }
      if (best === null || bestDot < -0.3) break; // sharp reversal → lift the pen
      seen.add(ek(cur, best));
      pts.push(xy(best));
      prev = cur;
      cur = best;
    }
    return pts;
  };

  const polylines = [];
  const fgPixels = [];
  for (let p = 0; p < skel.length; p++) if (skel[p]) fgPixels.push(p);

  const seed = (pred) => {
    for (const p of fgPixels) {
      if (!pred(nbrs(p).length)) continue;
      for (const nb of nbrs(p)) if (!seen.has(ek(p, nb))) polylines.push(walk(p, nb));
    }
  };
  seed((deg) => deg === 1); // start at endpoints (pen-down points)
  seed((deg) => deg >= 3); // then junctions
  seed(() => true); // then any leftover loops
  return polylines;
}

// Ramer–Douglas–Peucker: drop points that don't bend the line much.
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const sq = (a, b) => (a - b) * (a - b);
  const seg = (p, a, b) => {
    const l = sq(a[0], b[0]) + sq(a[1], b[1]);
    if (!l) return Math.sqrt(sq(p[0], a[0]) + sq(p[1], a[1]));
    let t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / l;
    t = Math.max(0, Math.min(1, t));
    return Math.sqrt(sq(p[0], a[0] + t * (b[0] - a[0])) + sq(p[1], a[1] + t * (b[1] - a[1])));
  };
  let maxD = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const dd = seg(pts[i], pts[0], pts[pts.length - 1]);
    if (dd > maxD) { maxD = dd; idx = i; }
  }
  if (maxD <= eps) return [pts[0], pts[pts.length - 1]];
  const left = simplify(pts.slice(0, idx + 1), eps);
  const right = simplify(pts.slice(idx), eps);
  return left.slice(0, -1).concat(right);
}

const plLen = (pts) => {
  let l = 0;
  for (let i = 1; i < pts.length; i++) {
    l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  return l;
};

// Order strokes to read like writing: left→right by leftmost point, but defer
// the long top headline (shirorekha) so letters land before their joining bar.
function orderStrokes(polys, w) {
  return polys
    .map((p) => {
      let minX = Infinity, maxX = -Infinity, minY = Infinity;
      for (const [x, y] of p) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
      }
      const wide = maxX - minX > 0.45 * w; // a span-the-word horizontal bar
      return { p, key: (wide ? 1e6 : 0) + minX, minY };
    })
    .sort((a, b) => a.key - b.key || a.minY - b.minY)
    .map((o) => o.p);
}

const toPathD = (pl) => {
  let d = `M${pl[0][0]} ${pl[0][1]}`;
  for (let i = 1; i < pl.length; i++) d += `L${pl[i][0]} ${pl[i][1]}`;
  return d;
};

// Pen-pressure profile along a stroke (t = 0..1): pointed taper at both ends
// where the pen touches down / lifts, with a gentle mid-stroke swell.
function halfWidthAt(t, baseHW) {
  const smooth = (x) => {
    const c = Math.max(0, Math.min(1, x));
    return c * c * (3 - 2 * c);
  };
  const te = 0.16; // taper length as a fraction of the stroke
  const taper = Math.min(smooth(t / te), smooth((1 - t) / te));
  const swell = 0.78 + 0.22 * Math.sin(Math.PI * t);
  return baseHW * taper * swell;
}

// Turn a centerline polyline into a filled, variable-width ribbon: offset each
// point along its normal by the local half-width, up one side and back the
// other. The tapered ends meet in a point, like a real pen stroke.
function buildRibbon(pts, baseHW) {
  const n = pts.length;
  const cum = [0];
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  const L = cum[n - 1] || 1;
  const left = [];
  const right = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const m = Math.hypot(tx, ty) || 1;
    tx /= m; ty /= m;
    const nx = -ty, ny = tx; // unit normal
    const hw = halfWidthAt(cum[i] / L, baseHW);
    left.push([pts[i][0] + nx * hw, pts[i][1] + ny * hw]);
    right.push([pts[i][0] - nx * hw, pts[i][1] - ny * hw]);
  }
  let d = `M${left[0][0].toFixed(1)} ${left[0][1].toFixed(1)}`;
  for (let i = 1; i < n; i++) d += `L${left[i][0].toFixed(1)} ${left[i][1].toFixed(1)}`;
  for (let i = n - 1; i >= 0; i--) d += `L${right[i][0].toFixed(1)} ${right[i][1].toFixed(1)}`;
  return d + "Z";
}

let maskUid = 0;

/* ---------- rendering + animation ---------- */

// Draw `text` into `stage`: a faint filled glyph (the target) with a pressured
// pen written down its centerline — each stroke a thin→thick→thin ribbon, drawn
// one at a time. No-op until the shaper is ready.
export function drawPhrase(stage, text) {
  if (!font) return;
  seqToken++; // cancel any in-flight sequence

  const { d, bbox } = buildOutline(text);
  const { grid, w, h, scale, pad } = rasterize(d, bbox);
  thin(grid, w, h);
  let polys = trace(grid, w, h)
    .map((p) => simplify(p, 0.9))
    .filter((p) => p.length >= 2 && plLen(p) >= 4); // drop specks
  polys = orderStrokes(polys, w);
  const baseHW = Math.max(3.5, Math.round(h * 0.028)); // max half-width of a stroke
  const coverPx = 2 * baseHW + 4; // reveal stroke wide enough to uncover the ribbon

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "write-trace");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Writing guide for ${text}`);

  const defs = document.createElementNS(SVG_NS, "defs");
  svg.append(defs);

  // Ghost: the filled glyph, mapped from font units into the same px space.
  const gWrap = document.createElementNS(SVG_NS, "g");
  gWrap.setAttribute(
    "transform",
    `translate(${pad - scale * bbox.minX} ${pad + scale * bbox.maxY}) scale(${scale} ${-scale})`
  );
  const ghost = document.createElementNS(SVG_NS, "path");
  ghost.setAttribute("class", "ghost");
  ghost.setAttribute("d", d);
  gWrap.append(ghost);
  svg.append(gWrap);

  // Ink: each stroke is a filled, variable-width ribbon (thin→thick→thin) shown
  // through its own <mask>. Animating the mask's centerline stroke from hidden→
  // shown "draws" the tapered ribbon, as if a pressured pen laid it down.
  const reveals = [];
  for (const pl of polys) {
    const uid = `wm${maskUid++}`;
    const mask = document.createElementNS(SVG_NS, "mask");
    mask.setAttribute("id", uid);
    mask.setAttribute("maskUnits", "userSpaceOnUse"); // full canvas → no bbox clipping
    mask.setAttribute("x", "0");
    mask.setAttribute("y", "0");
    mask.setAttribute("width", String(w));
    mask.setAttribute("height", String(h));
    const reveal = document.createElementNS(SVG_NS, "path");
    reveal.setAttribute("d", toPathD(pl));
    reveal.setAttribute("fill", "none");
    reveal.setAttribute("stroke", "#fff");
    reveal.setAttribute("stroke-linecap", "round");
    reveal.setAttribute("stroke-linejoin", "round");
    reveal.setAttribute("stroke-width", String(coverPx));
    mask.append(reveal);
    defs.append(mask);

    const ink = document.createElementNS(SVG_NS, "path");
    ink.setAttribute("class", "ink");
    ink.setAttribute("d", buildRibbon(pl, baseHW));
    ink.setAttribute("mask", `url(#${uid})`);
    svg.append(ink);

    reveals.push(reveal); // the reveal stroke is what gets animated
  }
  stage.replaceChildren(svg);

  // Measure each reveal stroke now it's in the DOM, and hide it (mask closed).
  for (const path of reveals) {
    const len = path.getTotalLength();
    path.dataset.len = String(len);
    path.style.transition = "none";
    path.style.strokeDasharray = String(len);
    path.style.strokeDashoffset = String(len);
  }

  lastStrokes = reveals;
  runSequence(reveals);
}

// Write the strokes one after another, each eased with a short pen-lift between.
function runSequence(strokes) {
  const token = ++seqToken;

  if (prefersReducedMotion()) {
    for (const p of strokes) {
      p.style.transition = "none";
      p.style.strokeDashoffset = "0";
    }
    return;
  }

  // Reset everything hidden first (matters on replay).
  for (const p of strokes) {
    p.style.transition = "none";
    p.style.strokeDashoffset = p.dataset.len;
  }
  if (strokes[0]) strokes[0].getBoundingClientRect(); // flush the reset

  const LIFT_MS = 110;
  let i = 0;
  const step = () => {
    if (token !== seqToken || i >= strokes.length) return;
    const p = strokes[i++];
    const len = Number(p.dataset.len);
    const dur = Math.max(260, len * msPerUnit); // msPerUnit follows the slider
    p.style.transition = `stroke-dashoffset ${dur}ms cubic-bezier(.45,.05,.35,1)`;
    p.style.strokeDashoffset = "0";
    setTimeout(() => {
      if (token === seqToken) step();
    }, dur + LIFT_MS);
  };
  step();
}

// Re-write the current phrase from the first stroke.
export function replay() {
  if (lastStrokes) runSequence(lastStrokes);
}
