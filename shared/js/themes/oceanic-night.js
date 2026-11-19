import { prefersReducedMotion } from "./motion.js";

const SHORE_THEME = "oceanic-night";
const BIRD_SVG = `<svg viewBox="0 0 28 16" fill="currentColor" aria-hidden="true">
  <path class="shore-bird-wing shore-bird-wing-far" opacity=".72" d="M14 10C12 6 14 3 21 1L25 2C20 3 17 6 17 10Z"/>
  <path class="shore-bird-wing" d="M16 10C13 5 8 2 1 3L4 5 8 6 6 6 10 8 13 11Z"/>
  <path d="M5 12L12 9C15 8 18 9 20 8L23 8 26 9.5 22 10C18 13 14 14 10 12.5L6 14 8 12Z"/>
</svg>`;

/** @type {number} */
let birdTimer = 0;

function clearShoreBirds() {
  if (birdTimer) {
    window.clearTimeout(birdTimer);
    birdTimer = 0;
  }
  document.querySelectorAll(".shore-bird").forEach((bird) => bird.remove());
}

/** @param {boolean} soon */
function scheduleShoreBird(soon) {
  if (prefersReducedMotion()) return;
  const wait = soon ? 2800 + Math.random() * 4200 : 14000 + Math.random() * 16000;
  birdTimer = window.setTimeout(spawnShoreBird, wait);
}

function spawnShoreBird() {
  birdTimer = 0;
  if (document.documentElement.dataset.theme !== SHORE_THEME || prefersReducedMotion()) return;
  const scene = document.querySelector(".shore-scene");
  if (!scene) {
    scheduleShoreBird(false);
    return;
  }
  const width = scene.clientWidth || 220;
  const fromLeft = Math.random() < 0.5;
  const count = Math.random() < 0.3 ? 2 : 1;
  const baseY = 8 + Math.random() * 28;
  for (let i = 0; i < count; i += 1) {
    const bird = document.createElement("span");
    bird.className = fromLeft ? "shore-bird" : "shore-bird is-rtl";
    bird.setAttribute("aria-hidden", "true");
    bird.innerHTML = BIRD_SVG;
    const y0 = baseY + i * 9;
    const y1 = y0 + (Math.random() * 16 - 8);
    const x0 = fromLeft ? -26 : width + 8;
    const x1 = fromLeft ? width + 16 : -30;
    scene.appendChild(bird);
    const lift = 5 + Math.random() * 6;
    const frames = Array.from({ length: 9 }, (_, step) => {
      const progress = step / 8;
      const x = x0 + (x1 - x0) * progress;
      const y = y0 + (y1 - y0) * progress - 4 * lift * progress * (1 - progress);
      return { transform: `translate(${x}px, ${y}px)` };
    });
    const anim = bird.animate(frames, {
      duration: 5200 + Math.random() * 1800,
      fill: "both",
      delay: i * 520,
    });
    anim.onfinish = () => bird.remove();
  }
  scheduleShoreBird(false);
}

/** @param {string} themeId */
export function syncOceanicNight(themeId) {
  clearShoreBirds();
  if (themeId === SHORE_THEME) scheduleShoreBird(true);
  scheduleGreetingFlicker(themeId);
}

let greetingFlickerTimer = 0;

function scheduleGreetingFlicker(themeId) {
  window.clearTimeout(greetingFlickerTimer);
  if (themeId !== SHORE_THEME || !document.getElementById("brand-hello")) return;

  greetingFlickerTimer = window.setTimeout(() => {
    if (!document.hidden && !prefersReducedMotion()) {
      flickerGreetingLetter();
    }
    scheduleGreetingFlicker(document.documentElement.dataset.theme);
  }, 10000 + Math.random() * 22000);
}

function flickerGreetingLetter() {
  const greeting = document.getElementById("brand-hello");
  if (!greeting) return;
  const text = greeting.textContent ?? "";
  const letters = Array.from(text.matchAll(/\p{L}\p{M}*/gu));
  if (!letters.length) return;
  const match = letters[Math.floor(Math.random() * letters.length)];
  const [letter] = match;
  const start = match.index ?? 0;
  const tube = document.createElement("span");
  tube.textContent = letter;
  greeting.replaceChildren(text.slice(0, start), tube, text.slice(start + letter.length));

  const flicker = tube.animate([
    { opacity: 1, offset: 0 },
    { opacity: 0.35, offset: 0.15 },
    { opacity: 0.94, offset: 0.32 },
    { opacity: 0.57, offset: 0.49 },
    { opacity: 1, offset: 0.72 },
  ], { duration: 310, easing: "steps(1, end)" });
  flicker.onfinish = () => {
    if (greeting.contains(tube)) greeting.textContent = text;
  };
}

export const oceanicNightScene = `<div class="shore-scene" aria-hidden="true">
  <div class="shore-day"></div>
  <div class="shore-night"></div>
  <svg class="shore-palms" viewBox="0 0 220 108" preserveAspectRatio="xMidYMax slice" focusable="false">
    <defs>
      <path id="shore-frond" fill="currentColor" d="M0 0C12-14 32-17 50-4
        L40-7 46 0 36-6 41 3 31-5 35 5 26-4 29 7 21-3 23 8
        16-2 17 9 11 0 10 8 6 2 3 5Z"/>
      <g id="shore-palm" fill="currentColor">
        <g class="shore-palm-sway">
          <path d="M-2-1C-1 14-5 33-14 54L-7 55C0 35 3 16 2-1Z"/>
          <g class="shore-palm-crown">
            <use href="#shore-frond" transform="rotate(-92) scale(.63)"/>
            <use href="#shore-frond" transform="rotate(-50) scale(.78)"/>
            <use href="#shore-frond" transform="rotate(-13) scale(.94)"/>
            <use href="#shore-frond" transform="rotate(22) scale(.92)"/>
            <use href="#shore-frond" transform="rotate(51) scale(.68)"/>
            <use href="#shore-frond" transform="scale(-.84 .84) rotate(-31)"/>
            <use href="#shore-frond" transform="scale(-1 1) rotate(3)"/>
            <use href="#shore-frond" transform="scale(-.78 .78) rotate(37)"/>
            <ellipse cy="1" rx="5" ry="3.5"/>
          </g>
        </g>
      </g>
    </defs>
    <path fill="#745d8d" opacity=".65" d="M81 105v-6h12v-3h7v4h8V86h8v-7h11v20h7V89h6V75h9v-4h7v23h5V82h12v16h5V57h4v-7h7v7h3v39h5V80h9v12h5v-5h9v21H81z"/>
    <g class="shore-city-lights" fill="none" stroke-linecap="round">
      <path stroke="#ffd198" stroke-width="1.1" stroke-dasharray="1 3" d="M112 90h12m-12 4h12m19-15h10m-10 4h10m-10 4h10m28-23h8m-8 5h8m-8 5h8m-8 5h8m-8 5h8"/>
      <path class="shore-neon-pink" stroke="#ff74ca" stroke-width="1.4" d="M116 81h10m58-27h4m3 4v28m10-3h6"/>
      <path class="shore-neon-cyan" stroke="#70f6ff" stroke-width="1.2" d="M142 76h11m10 9h8m-8 3h8m27 9h10"/>
    </g>
    <use href="#shore-palm" transform="translate(20 39) scale(1.35)"/>
    <use href="#shore-palm" class="shore-palm-small" transform="translate(65 72) scale(-.78 .78)"/>
  </svg>
</div>`;
