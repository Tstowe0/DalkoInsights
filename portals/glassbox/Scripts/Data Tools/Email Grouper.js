import { mountFileTool } from "../_shared/file-ui.js";
import { downloadCsv, stampName } from "../_shared/excel.js";

export const meta = {
  id: "Email Grouper",
  title: "Email Grouper",
  category: "Data Tools",
  script: "Data Tools/Email Grouper.js",
};

const DEFAULT_MAX = 1500;

/**
 * @param {string} raw
 * @param {number} maxChars
 */
function groupEmails(raw, maxChars) {
  const emails = raw
    .split(/[;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  /** @type {string[]} */
  const blocks = [];
  /** @type {string[]} */
  let current = [];
  let length = 0;

  for (const email of emails) {
    const addLen = email.length + (current.length ? 1 : 0); // +1 for ;
    if (current.length && length + addLen > maxChars) {
      blocks.push(current.join(";"));
      current = [email];
      length = email.length;
    } else {
      current.push(email);
      length += addLen;
    }
  }
  if (current.length) blocks.push(current.join(";"));
  return { emails: emails.length, blocks };
}

/**
 * @param {HTMLElement} parent
 * @param {{ onBack: () => void, log: (msg: string) => void }} ctx
 */
export async function loadGui(parent, ctx) {
  mountFileTool(parent, {
    title: meta.title,
    category: meta.category,
    instructions: `Split a list of emails into blocks that fit a character limit (default 1500).

Workflow:
1. Upload a .txt / .csv / .eml file (semicolon or newline separated).
2. Optionally change max characters per block.
3. Run → download CSV with Block # and Content.`,
    onBack: ctx.onBack,
    log: ctx.log,
    accept: ".txt,.csv,.eml,text/plain,text/csv",
    buildExtra(extra) {
      extra.innerHTML = `
        <label class="gb-check ui-field-inline">
          <span>Max characters per block</span>
          <input class="ui-input ui-input--sm" type="number" data-max min="100" max="10000" value="${DEFAULT_MAX}" style="width:8rem" />
        </label>
      `;
    },
    async onRun(files, ui) {
      const max = Number(
        /** @type {HTMLInputElement | null} */ (ui.extra.querySelector("[data-max]"))?.value
      ) || DEFAULT_MAX;
      const text = await files[0].text();
      const { emails, blocks } = groupEmails(text, max);
      ctx.log(`Grouped ${emails} emails into ${blocks.length} block(s) (max ${max} chars).`);

      const lines = ["Block #,Content"];
      blocks.forEach((block, i) => {
        const safe = `"${block.replaceAll('"', '""')}"`;
        lines.push(`${i + 1},${safe}`);
      });
      const base = files[0].name.replace(/\.[^.]+$/, "");
      const outName = `${base}_EmailBlocks_${stampName()}.csv`;
      downloadCsv(lines.join("\n"), outName);
      ui.setStatus("Complete");
      ctx.log(`Saved ${outName}`);
    },
  });
}
