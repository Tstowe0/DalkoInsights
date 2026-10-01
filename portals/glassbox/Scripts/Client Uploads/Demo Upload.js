import { mountFileTool } from "../_shared/file-ui.js?v=20260930-demo";
import { downloadBlob, stampName } from "../_shared/excel.js";
import { isLocalBuild, sendToRack } from "../../../../shared/js/ftp-rack.js?v=20260930-ftprack";

export const meta = {
  id: "Demo Upload",
  title: "Demo Upload",
  category: "Client Uploads",
  script: "Client Uploads/Demo Upload.js",
};

const officeSite = isLocalBuild();

/**
 * @param {File} file
 */
function demoName(file) {
  const dot = file.name.lastIndexOf(".");
  const ext = dot > 0 ? file.name.slice(dot) : "";
  const seconds = String(new Date().getSeconds()).padStart(2, "0");
  return `Demo_${stampName()}${seconds}${ext}`;
}

/**
 * @param {HTMLElement} parent
 * @param {{ onBack: () => void, log: (msg: string) => void }} ctx
 */
export async function loadGui(parent, ctx) {
  mountFileTool(parent, {
    title: meta.title,
    category: meta.category,
    instructions: officeSite
      ? `Send a finished file to the Demo Customer FTP.

Workflow:
1. Choose the file to upload.
2. Run saves a local Demo_ copy.
3. Send to TMS hands that file to the FTP rack. The rack places it in /DALKO.`
      : `Send a finished file to the Demo Customer FTP.

Workflow:
1. Choose the file to upload.
2. Run saves a local Demo_ copy.
Send to TMS is available on the office site. This public site cannot reach the FTP rack.`,
    onBack: ctx.onBack,
    log: ctx.log,
    sendLabel: officeSite ? "Send to TMS" : "",
    async onRun(files, ui) {
      const outName = demoName(files[0]);
      downloadBlob(files[0], outName);
      ui.setStatus("Complete");
      ctx.log(`Saved ${outName}`);
    },
    async onSend(files, ui) {
      const file = files[0];
      const outName = demoName(file);
      const message = await sendToRack("demo", outName, file);
      ui.setStatus("Sent");
      ctx.log(`Sent ${outName} to the Demo Customer FTP. ${message}`);
    },
  });
}
