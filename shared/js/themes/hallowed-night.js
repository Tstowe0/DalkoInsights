import { prefersReducedMotion } from "./motion.js";

const HALLOWEEN_THEME = "hallowed-night";

const GHOST_BOW = `<g stroke="#8c2b65" stroke-width="0.9" stroke-linejoin="round">
  <path fill="#f68cbd" d="M27 7c-2-2-5-3-6-2-1 1-1 4 0 6 1 1 4 0 6-2m2-2c2-2 5-3 6-2 1 1 1 4 0 6-1 1-4 0-6-2"/>
  <rect x="26" y="6" width="4" height="4" rx="1.5" fill="#ffc5e0"/>
</g>`;

const ghostSvg = (hasBow) => `<svg viewBox="0 0 40 48" aria-hidden="true">
  <path fill="currentColor" d="M20 3.5C11.4 3.5 4.5 10.6 4.5 20.2V41c0 1.9 2.2 2.2 3.2.6 1.3-2.1 3.4-2.1 4.8 0 1.3 2.1 3.4 2.1 4.8 0 1.3-2.1 3.4-2.1 4.8 0 1.3 2.1 3.4 2.1 4.8 0 1-1.6 3.2-1.3 3.2-.6V20.2C35.5 10.6 28.6 3.5 20 3.5Z"/>
  <g class="hallow-ghost-eye"><circle cx="14.2" cy="20" r="2.15" fill="#1a1024"/></g>
  <g class="hallow-ghost-eye"><circle cx="24.6" cy="20" r="2.15" fill="#1a1024"/></g>
  <ellipse cx="19.4" cy="27.2" rx="2.6" ry="1.5" fill="#1a1024" opacity=".32"/>
  ${hasBow ? GHOST_BOW : ""}
</svg>`;

/** @type {number} */
let ghostTimer = 0;
/** @type {number} */
let lookTimer = 0;
/** @type {HTMLElement | null} */
let ghostEl = null;
let ghostWatching = false;
let glanceCool = false;
/** @type {{ x: number, y: number } | null} */
let ghostPointer = null;

function restLook(wrap) {
  wrap.style.setProperty("--look-x", "0px");
  wrap.style.setProperty("--look-y", "0px");
}

function lookToward(wrap, x, y) {
  const box = wrap.getBoundingClientRect();
  const dx = x - (box.left + box.width * 0.5);
  const dy = y - (box.top + box.height * 0.4);
  const dist = Math.hypot(dx, dy) || 1;
  const sprite = wrap.querySelector("svg");
  const facing = sprite && getComputedStyle(sprite).scale.startsWith("-") ? -1 : 1;
  wrap.style.setProperty("--look-x", `${((dx / dist) * 2.8 * facing).toFixed(2)}px`);
  wrap.style.setProperty("--look-y", `${((dy / dist) * 2).toFixed(2)}px`);
}

function stopGhostLook() {
  ghostWatching = false;
  glanceCool = false;
  ghostPointer = null;
  if (lookTimer) {
    window.clearTimeout(lookTimer);
    lookTimer = 0;
  }
  if (ghostEl) restLook(ghostEl);
  window.removeEventListener("pointermove", onGhostPointer);
}

function endGlance(wrap) {
  ghostWatching = false;
  glanceCool = true;
  restLook(wrap);
  lookTimer = window.setTimeout(() => {
    glanceCool = false;
    if (wrap.isConnected && !wrap.classList.contains("is-pop")) scheduleGlance(wrap);
  }, 1400 + Math.random() * 1800);
}

function beginGlance(wrap) {
  if (ghostWatching || glanceCool || !wrap.isConnected || wrap.classList.contains("is-pop")) return;
  window.clearTimeout(lookTimer);
  ghostWatching = true;
  if (ghostPointer) lookToward(wrap, ghostPointer.x, ghostPointer.y);
  lookTimer = window.setTimeout(() => {
    if (wrap.isConnected) endGlance(wrap);
  }, 1100 + Math.random() * 1500);
}

function scheduleGlance(wrap) {
  lookTimer = window.setTimeout(() => beginGlance(wrap), 2400 + Math.random() * 4600);
}

function onGhostPointer(event) {
  ghostPointer = { x: event.clientX, y: event.clientY };
  const wrap = ghostEl;
  if (!wrap || wrap.classList.contains("is-pop")) return;
  if (ghostWatching) {
    lookToward(wrap, event.clientX, event.clientY);
    return;
  }
  if (glanceCool) return;
  const box = wrap.getBoundingClientRect();
  const near = Math.hypot(
    event.clientX - (box.left + box.width * 0.5),
    event.clientY - (box.top + box.height * 0.4)
  );
  if (near < 130) beginGlance(wrap);
}

function startGhostLook(wrap) {
  window.addEventListener("pointermove", onGhostPointer, { passive: true });
  scheduleGlance(wrap);
}

function clearHalloweenGhosts() {
  stopGhostLook();
  if (ghostTimer) {
    window.clearTimeout(ghostTimer);
    ghostTimer = 0;
  }
  ghostEl?.remove();
  ghostEl = null;
}

/** @param {boolean} soon */
function scheduleHalloweenGhost(soon) {
  if (prefersReducedMotion()) return;
  const wait = soon ? 2800 + Math.random() * 5000 : 18000 + Math.random() * 36000;
  ghostTimer = window.setTimeout(spawnHalloweenGhost, wait);
}

function ghostAnchor() {
  const gravestones = document.querySelectorAll(".hallow-graves .hallow-grave");
  const anchor = gravestones[Math.floor(Math.random() * gravestones.length)];
  if (!anchor?.getClientRects().length) return null;
  const r = anchor.getBoundingClientRect();
  return {
    x: r.left + r.width / 2,
    y: r.top,
  };
}

function finishGhost(wrap) {
  stopGhostLook();
  wrap.remove();
  if (ghostEl === wrap) ghostEl = null;
  if (document.documentElement.dataset.theme === HALLOWEEN_THEME) {
    scheduleHalloweenGhost(false);
  }
}

/** @param {HTMLElement} wrap */
function popGhost(wrap) {
  if (wrap.classList.contains("is-pop")) return;
  stopGhostLook();
  const cs = getComputedStyle(wrap);
  wrap.style.setProperty("--pop-from", cs.transform === "none" ? "translate(0, 0)" : cs.transform);
  wrap.getAnimations().forEach((anim) => {
    if (anim.effect?.target === wrap) anim.cancel();
  });
  wrap.querySelector("svg")?.getAnimations().forEach((anim) => anim.pause());
  wrap.classList.add("is-pop");
  wrap.setAttribute("aria-hidden", "true");
  wrap.removeAttribute("tabindex");
  for (let i = 0; i < 6; i += 1) {
    const speck = document.createElement("span");
    speck.className = "hallow-pop-speck";
    speck.style.setProperty("--a", `${i * 60}deg`);
    wrap.appendChild(speck);
  }
}

const GHOST_W = 21;
const GHOST_H = 25;

function yardBounds() {
  const yard = document.querySelector(".hallow-graves");
  const side = document.querySelector(".sidebar");
  if (!yard || !side) return null;
  const stones = yard.getBoundingClientRect();
  const bar = side.getBoundingClientRect();
  const minX = bar.left + 8;
  const maxX = Math.max(minX, bar.right - GHOST_W - 8);
  const minY = stones.top - GHOST_H - 13;
  const maxY = stones.bottom - GHOST_H;
  return { minX, maxX, minY, maxY };
}

function clampYard(point, yard) {
  return {
    x: Math.min(yard.maxX, Math.max(yard.minX, point.x)),
    y: Math.min(yard.maxY, Math.max(yard.minY, point.y)),
  };
}

/** Gentle curve through the yard so each turn eases instead of snapping. */
function driftPath(stops) {
  const samples = [];
  const legs = stops.length - 1;
  const steps = 6;
  for (let i = 0; i < legs; i += 1) {
    const p0 = stops[Math.max(0, i - 1)];
    const p1 = stops[i];
    const p2 = stops[i + 1];
    const p3 = stops[Math.min(stops.length - 1, i + 2)];
    for (let s = 0; s < steps; s += 1) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      samples.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  samples.push(stops[stops.length - 1]);
  return samples;
}

/** @param {HTMLElement} wrap */
function roamGhost(wrap) {
  const yard = yardBounds();
  if (!yard) return null;
  const gx = Number.parseFloat(wrap.style.getPropertyValue("--gx")) || yard.minX;
  const gy = Number.parseFloat(wrap.style.getPropertyValue("--gy")) || yard.maxY;
  const spot = () => ({
    x: yard.minX + Math.random() * (yard.maxX - yard.minX),
    y: yard.minY + Math.random() * (yard.maxY - yard.minY),
  });
  const home = clampYard({ x: gx, y: gy - 4 }, yard);
  const grave = ghostAnchor();
  if (!grave) return null;
  const destination = clampYard({ x: grave.x - GHOST_W / 2, y: grave.y - GHOST_H + 2 }, yard);
  const stops = [home, spot(), spot(), spot(), destination];
  const samples = driftPath(stops).map((point) => clampYard(point, yard));
  samples[0] = home;
  samples[samples.length - 1] = destination;
  const frames = samples.map((point, index) => {
    const dx = Math.round((point.x - gx) * 10) / 10;
    const dy = Math.round((point.y - gy) * 10) / 10;
    return {
      offset: index / (samples.length - 1),
      opacity: 0.92,
      transform: `translate(${dx}px, ${dy}px) scale(0.94)`,
    };
  });
  let facing = 1;
  const turns = samples.map((point, index) => {
    const next = samples[index + 1] ?? point;
    const dx = next.x - point.x;
    if (Math.abs(dx) >= 0.5) facing = Math.sign(dx);
    return { offset: frames[index].offset, scale: `${facing} 1`, easing: "steps(1, end)" };
  });
  const emerge = wrap.animate(
    [
      { opacity: 0, transform: "translate(0px, 8px) scale(0.16)" },
      { opacity: 0.92, transform: `translate(${home.x - gx}px, ${home.y - gy}px) scale(0.94)` },
    ],
    { duration: 1600, easing: "cubic-bezier(0.22, 0.8, 0.3, 1)", fill: "forwards" }
  );
  emerge.onfinish = () => {
    if (!wrap.isConnected || wrap.classList.contains("is-pop")) return;
    const timing = {
      duration: 32000 + Math.random() * 8000,
      easing: "linear",
      fill: "forwards",
    };
    const drift = wrap.animate(frames, timing);
    wrap.querySelector("svg")?.animate(turns, timing);
    drift.onfinish = () => {
      if (!wrap.isConnected || wrap.classList.contains("is-pop")) return;
      stopGhostLook();
      const { opacity, transform } = frames[frames.length - 1];
      const sink = wrap.animate([
        { opacity, transform },
        { opacity: 0, transform: `translate(${grave.x - GHOST_W / 2 - gx}px, ${grave.y - gy - 5}px) scale(0.12)` },
      ], {
        duration: 1300,
        easing: "ease-in",
        fill: "forwards",
      });
      sink.onfinish = () => finishGhost(wrap);
    };
  };
  wrap.dataset.roam = "1";
  return emerge;
}

function spawnHalloweenGhost() {
  ghostTimer = 0;
  if (document.documentElement.dataset.theme !== HALLOWEEN_THEME || prefersReducedMotion()) {
    return;
  }
  const tomb = ghostAnchor();
  if (!tomb) {
    scheduleHalloweenGhost(false);
    return;
  }
  stopGhostLook();
  ghostEl?.remove();

  const wrap = document.createElement("button");
  wrap.type = "button";
  wrap.className = "hallow-ghost";
  wrap.setAttribute("aria-label", "Pop ghost");
  wrap.title = "Pop";
  wrap.style.setProperty("--gx", `${Math.round(tomb.x - GHOST_W / 2)}px`);
  wrap.style.setProperty("--gy", `${Math.round(tomb.y - GHOST_H + 6)}px`);
  const hasBow = Math.random() < 0.5;
  wrap.innerHTML = `<span class="hallow-ghost-bob">${ghostSvg(hasBow)}</span>`;
  wrap.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    popGhost(wrap);
  });
  wrap.addEventListener("animationend", (event) => {
    if (event.animationName === "hallow-ghost-pop") finishGhost(wrap);
  });
  ghostEl = wrap;
  document.body.appendChild(wrap);
  roamGhost(wrap);
  startGhostLook(wrap);
}

/** @param {string} themeId */
export function syncHalloweenGhosts(themeId) {
  clearHalloweenGhosts();
  if (themeId === HALLOWEEN_THEME) scheduleHalloweenGhost(true);
}

export const hallowedNightScene = `<div class="hallow-scene" aria-hidden="true">
  <div class="hallow-landscape">
    <div class="hallow-moon"></div>
    <div class="hallow-ridge"></div>
    <div class="hallow-manor"><div class="hallow-windows"></div></div>
    <div class="hallow-tree"></div>
    <div class="hallow-fog"></div>
    <div class="hallow-ground"></div>
    <div class="hallow-lantern"></div>
    <div class="hallow-graves">
      <span class="hallow-grave"></span><span class="hallow-grave"></span><span class="hallow-grave"></span>
    </div>
  </div>
</div>`;
