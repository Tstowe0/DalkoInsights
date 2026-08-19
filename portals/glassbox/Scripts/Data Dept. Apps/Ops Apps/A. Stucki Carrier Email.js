import { mountCarrierEmailTool } from "../../_shared/carrier-email-form.js";

export const meta = {
  id: "A. Stucki Carrier Email",
  title: "A. Stucki Carrier Email",
  category: "Ops Apps",
  script: "Data Dept. Apps/Ops Apps/A. Stucki Carrier Email.js",
};

/**
 * @param {HTMLElement} parent
 * @param {{ onBack: () => void, log: (msg: string) => void }} ctx
 */
export async function loadGui(parent, ctx) {
  await mountCarrierEmailTool(parent, {
    title: meta.title,
    category: meta.category,
    formTitle: "A. Stucki Load Form",
    customerKey: "A. Stucki Carriers",
    onBack: ctx.onBack,
    log: ctx.log,
  });
}
