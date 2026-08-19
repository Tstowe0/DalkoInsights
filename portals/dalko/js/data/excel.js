/**
 * @param {ArrayBuffer} buffer
 * @returns {Promise<{ headers: unknown[], rows: unknown[][] }>}
 */
export async function parseExcelBuffer(buffer) {
  if (typeof XLSX === "undefined") {
    throw new Error("Excel library failed to load. Check your network connection.");
  }
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Workbook has no sheets.");
  const sheet = workbook.Sheets[sheetName];
  /** @type {unknown[][]} */
  const grid = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    raw: true,
  });
  if (!grid.length) throw new Error("Sheet is empty.");
  const headers = grid[0] ?? [];
  const rows = grid.slice(1).filter((row) => row.some((c) => c != null && c !== ""));
  return { headers, rows };
}

/**
 * Read a File into an ArrayBuffer with optional progress (0–1).
 * @param {File} file
 * @param {(ratio: number) => void} [onProgress]
 * @returns {Promise<ArrayBuffer>}
 */
export function readFileAsArrayBuffer(file, onProgress) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(event.loaded / event.total);
      }
    };
    reader.onload = () => {
      resolve(/** @type {ArrayBuffer} */ (reader.result));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file."));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * @param {File} file
 * @param {(ratio: number) => void} [onProgress]
 */
export async function readExcelFile(file, onProgress) {
  const buffer = await readFileAsArrayBuffer(file, onProgress);
  const data = await parseExcelBuffer(buffer);
  return { ...data, fileName: file.name };
}
