import { mountCarrierEmailTool } from "../../_shared/carrier-email-form.js";

export const meta = {
  id: "Maddox Carrier Email",
  title: "Maddox Carrier Email",
  category: "Ops Apps",
  script: "Data Dept. Apps/Ops Apps/Maddox Carrier Email.js",
};

/**
 * @param {HTMLElement} parent
 * @param {{ onBack: () => void, log: (msg: string) => void }} ctx
 */
export async function loadGui(parent, ctx) {
  await mountCarrierEmailTool(parent, {
    title: meta.title,
    category: meta.category,
    formTitle: "Maddox Load Form",
    customerKey: "Maddox Carriers",
    onBack: ctx.onBack,
    log: ctx.log,
  });
}
