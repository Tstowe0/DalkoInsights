/**
 * Resolves and loads a tool module from Scripts/ (mirrors Python _launch_tool).
 */

/**
 * @typedef {object} ToolContext
 * @property {() => void} onBack
 * @property {(msg: string) => void} log
 */

/**
 * @param {string} scriptPath  e.g. "Accounting/AP-AR Lookup.js"
 * @param {HTMLElement} parent
 * @param {ToolContext} ctx
 */
export async function launchTool(scriptPath, parent, ctx) {
  parent.innerHTML = `
    <section class="gb-tool gb-tool-loading">
      <p class="gb-tool-loading-msg">Launching ${escapeHtml(scriptPath)}…</p>
    </section>
  `;
  ctx.log(`Launching: ${scriptPath}`);

  try {
    const href = new URL(`../Scripts/${scriptPath}`, import.meta.url).href;
    const mod = await import(/* @vite-ignore */ href);
    if (typeof mod.loadGui !== "function") {
      throw new Error("No loadGui() export found in tool module.");
    }
    parent.innerHTML = "";
    await mod.loadGui(parent, ctx);
    ctx.log(`${scriptPath} loaded successfully.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.log(`Error loading ${scriptPath}: ${message}`);
    parent.innerHTML = `
      <section class="gb-tool">
        <header class="gb-tool-header">
          <div class="gb-tool-heading">
            <h2 class="gb-tool-title">Tool unavailable</h2>
            <p class="gb-tool-status">Could not load module</p>
          </div>
          <button type="button" class="btn btn-ghost" data-tool-back>Back</button>
        </header>
        <div class="gb-tool-panels">
          <article class="gb-tool-panel">
            <p class="gb-tool-note">No script found or module failed to load. This may be a placeholder for a future tool.</p>
            <p class="gb-tool-id"><code>${escapeHtml(scriptPath)}</code></p>
            <p class="gb-tool-note">${escapeHtml(message)}</p>
          </article>
        </div>
      </section>
    `;
    parent.querySelector("[data-tool-back]")?.addEventListener("click", () => ctx.onBack());
  }
}

/** @param {string} value */
function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
