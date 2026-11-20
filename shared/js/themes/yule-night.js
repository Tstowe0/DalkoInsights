import { prefersReducedMotion } from "./motion.js";

let flybyTimer;
let activeSleigh;

function scheduleYuleFlyby(scene) {
  const delay = (45 + Math.random() * 30) * 60_000;
  flybyTimer = window.setTimeout(() => {
    if (prefersReducedMotion()) return;
    const width = scene.clientWidth;
    if (!document.hidden && width > 0) flyYuleSleigh(scene, width);
    scheduleYuleFlyby(scene);
  }, delay);
}

function flyYuleSleigh(scene, width) {
  const sleigh = document.createElement("div");
  sleigh.className = "yule-sleigh";
  sleigh.innerHTML = `
    <span class="yule-sleigh-carriage"></span>
    <span class="yule-sleigh-reins"></span>
    <span class="yule-sleigh-team">
      <span class="yule-sleigh-deer"></span>
      <span class="yule-sleigh-deer"></span>
      <span class="yule-sleigh-deer"></span>
      <span class="yule-sleigh-deer"></span>
    </span>`;
  scene.prepend(sleigh);
  activeSleigh = sleigh;

  const start = -sleigh.offsetWidth - 8;
  const end = width + 8;
  const flight = sleigh.animate([
    { transform: `translate(${start}px, 6px)` },
    { transform: `translate(${(start + end) / 2}px, -9px)` },
    { transform: `translate(${end}px, -18px)` },
  ], { duration: 8500, easing: "linear", fill: "both" });
  flight.onfinish = () => {
    sleigh.remove();
    if (activeSleigh === sleigh) activeSleigh = null;
  };
}

export function syncYuleSleigh(themeId) {
  window.clearTimeout(flybyTimer);
  if (activeSleigh) {
    activeSleigh.getAnimations().forEach(animation => animation.cancel());
    activeSleigh.remove();
    activeSleigh = null;
  }
  if (themeId !== "yule-night" || prefersReducedMotion()) return;
  const scene = document.querySelector(".yule-scene");
  if (scene) scheduleYuleFlyby(scene);
}

export const yuleNightScene = `<div class="yule-scene" aria-hidden="true">
  <div class="yule-village">
    <div class="yule-moon"></div>
    <div class="yule-mountains"></div>
    <div class="yule-snowbank"></div>
    <div class="yule-smoke yule-smoke-left"></div>
    <div class="yule-smoke yule-smoke-right"></div>
    <div class="yule-cabin yule-cabin-left"><div class="yule-eaves"></div></div>
    <div class="yule-cabin yule-cabin-right"><div class="yule-eaves"></div></div>
    <div class="yule-drift yule-drift-left"></div>
    <div class="yule-drift yule-drift-right"></div>
    <div class="yule-tree"></div>
    <div class="yule-tree-lights"></div>
    <div class="yule-presents"><span></span><span></span><span></span></div>
  </div>
</div>`;
