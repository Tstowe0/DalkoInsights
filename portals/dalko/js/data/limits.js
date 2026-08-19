/** Soft warn — user can continue after confirm */
export const WARN_FILE_BYTES = 35 * 1024 * 1024;
/** Hard stop — refuse to load */
export const MAX_FILE_BYTES = 120 * 1024 * 1024;
/** Soft warn after parse */
export const WARN_ROW_COUNT = 80_000;
/** Hard stop after parse */
export const MAX_ROW_COUNT = 300_000;

/** @param {number} bytes */
export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * @param {File} file
 * @returns {{ ok: true } | { ok: false, reason: string } | { ok: "confirm", message: string }}
 */
export function checkFileSize(file) {
  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      reason: `This file is ${formatFileSize(file.size)} (limit ${formatFileSize(MAX_FILE_BYTES)}). Split the export or filter in TMS before uploading.`,
    };
  }
  if (file.size > WARN_FILE_BYTES) {
    return {
      ok: "confirm",
      message: `This file is ${formatFileSize(file.size)}. Large files can take a minute and use more memory. Continue?`,
    };
  }
  return { ok: true };
}

/**
 * @param {number} rowCount
 * @returns {{ ok: true } | { ok: false, reason: string } | { ok: "confirm", message: string }}
 */
export function checkRowCount(rowCount) {
  if (rowCount > MAX_ROW_COUNT) {
    return {
      ok: false,
      reason: `This sheet has ${rowCount.toLocaleString()} data rows (limit ${MAX_ROW_COUNT.toLocaleString()}). Narrow the TMS date range and export again.`,
    };
  }
  if (rowCount > WARN_ROW_COUNT) {
    return {
      ok: "confirm",
      message: `This sheet has ${rowCount.toLocaleString()} rows. Analysis may take a while and use significant memory. Continue?`,
    };
  }
  return { ok: true };
}
