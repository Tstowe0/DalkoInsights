/**
 * Batch Mapper profile registry — add new formats here.
 */

import { manualProfile } from "./manual.js?v=20260804-profiles";
import { boxlightFreightRfpProfile } from "./boxlight-freight-rfp.js?v=20260804-profiles";

/** @typedef {{
 *   id: string,
 *   label: string,
 *   description: string,
 *   transform: null | ((buffer: ArrayBuffer, ctx: { templateHeaders: string[], log?: (msg: string) => void }) => Promise<{ rows: Record<string, unknown>[], headers: string[], meta?: object }>)
 * }} BatchProfile */

/** All registered entries (includes manual stub). */
export const PROFILES = [manualProfile, boxlightFreightRfpProfile];

/** Premade input formats shown in the Profile section (has a transform). */
export const SAVED_PROFILES = PROFILES.filter((p) => typeof p.transform === "function");

/** @param {string} id */
export function getProfile(id) {
  return PROFILES.find((p) => p.id === id) || null;
}
