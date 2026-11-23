const laneMarks = [
  ["0s", "4%", 0.16],
  ["-0.48s", "13%", 0.28],
  ["-0.96s", "30%", 0.44],
  ["-1.44s", "53%", 0.64],
  ["-1.92s", "82%", 0.9],
].map(([delay, position, scale]) => `
      <span class="rainy-drive-mark" style="--mark-delay:${delay};--mark-position:${position};--mark-scale:${scale}"></span>`
).join("");

const rainDrops = [
  [5, 36, 11, 1.33, 0.31], [13, 54, 18, 0.93, 0.76],
  [24, 25, 8, 1.48, 0.98], [34, 68, 14, 1.14, 0.13],
  [44, 31, 21, 0.85, 0.52], [52, 53, 10, 1.38, 0.91],
  [61, 22, 12, 1.26, 0.63], [68, 64, 19, 0.96, 0.38],
  [76, 40, 8, 1.51, 0.06], [84, 29, 17, 1.02, 0.79],
  [91, 59, 13, 1.12, 0.24], [99, 23, 9, 1.39, 0.46],
  [106, 47, 20, 0.91, 0.67], [115, 34, 12, 1.23, 0.88],
].map(([x, y, length, duration, delay]) => `
      <span class="rainy-drive-drop" style="--drop-x:${x}%;--drop-y:${y}%;--drop-length:${length}px;--drop-duration:${duration}s;--drop-delay:-${delay}s"></span>`
).join("");

export const rainyDriveScene = `<div class="rainy-drive-scene" aria-hidden="true">
  <div class="rainy-drive-landscape">
    <div class="rainy-drive-sun"></div>
    <div class="rainy-drive-ridge"></div>
    <div class="rainy-drive-road">${laneMarks}</div>
    <div class="rainy-drive-truck"><span class="rainy-drive-trailer"></span></div>
    <div class="rainy-drive-rain">${rainDrops}</div>
  </div>
</div>`;
