import { mountFileTool } from "../_shared/file-ui.js?v=20261027-titlebar";
import { downloadBlob, stampName } from "../_shared/excel.js";
import { sendToRack } from "../../../../shared/js/ftp-rack.js?v=20261023-rack";
import { confirmDialog } from "../../../../shared/js/dialog.js?v=20261006-nobrand";

export const meta = {
  id: "Demo Upload",
  title: "Demo Upload",
  category: "Client Uploads",
  script: "Client Uploads/Demo Upload.js",
};

const officeSite = true;

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
      ? `Send a finished file to the Demo Customer FTP. The file is not remapped.

Workflow:
1. Choose the file to upload.
2. Run and Save Locally downloads a local Demo_ copy.
3. Run and Send To TMS hands that file to the FTP rack. The rack places it in /DALKO.`
      : `Send a finished file to the Demo Customer FTP. The file is not remapped.

Workflow:
1. Choose the file to upload.
2. Run and Save Locally downloads a local Demo_ copy.
Run and Send To TMS is available on the office site. This public site cannot reach the FTP rack.`,
    onBack: ctx.onBack,
    log: ctx.log,
    layout: "board",
    runLabel: "Run and Save Locally",
    sendLabel: officeSite ? "Run and Send To TMS" : "",
    board: {
      upload: {
        title: "Upload File",
        text: "Choose the file to upload.",
      },
      run: {
        title: "Run Report",
        text: officeSite
          ? "Run and Save Locally downloads a Demo_ copy. Run and Send To TMS hands that file to the rack."
          : "Run and Save Locally downloads a Demo_ copy.",
      },
    },
    async onRun(files, ui) {
      const outName = demoName(files[0]);
      downloadBlob(files[0], outName);
      ui.setStatus(`Saved ${outName}`);
    },
    async onSend(files, ui) {
      const ok = await confirmDialog(
        "Send this file to the rack? It will be placed in /DALKO.",
        { title: "Run and Send To TMS", okLabel: "Send", cancelLabel: "Cancel" }
      );
      if (!ok) {
        ui.setStatus("Send cancelled.");
        return;
      }
      const file = files[0];
      const outName = demoName(file);
      ui.setStatus(`Sending ${outName}…`);
      const message = await sendToRack("demo", outName, file);
      ui.setStatus(message);
    },
  });
}
