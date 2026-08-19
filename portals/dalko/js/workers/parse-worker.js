/* Classic worker — keeps SheetJS parse off the UI thread */
importScripts("https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js");

/**
 * @param {number} pct
 * @param {string} message
 * @param {number} jobId
 * @param {string} [phase]
 */
function reportProgress(jobId, pct, message, phase) {
  self.postMessage({
    jobId,
    type: "progress",
    phase: phase || "parsing",
    pct: Math.max(0, Math.min(100, Math.round(pct))),
    message,
  });
}

/**
 * @param {ArrayBuffer} buffer
 * @param {number} jobId
 * @returns {{ headers: unknown[], rows: unknown[][], sheetName: string }}
 */
function parseExcelBuffer(buffer, jobId) {
  if (typeof XLSX === "undefined") {
    throw new Error("Excel library failed to load in worker.");
  }

  reportProgress(jobId, 5, "Opening workbook…", "read");
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  reportProgress(jobId, 35, "Workbook open — reading sheet…", "read");

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Workbook has no sheets.");
  const sheet = workbook.Sheets[sheetName];
  const ref = sheet["!ref"];
  if (!ref) throw new Error("Sheet is empty.");

  const fullRange = XLSX.utils.decode_range(ref);
  const totalRows = fullRange.e.r - fullRange.s.r + 1;
  if (totalRows <= 0) throw new Error("Sheet is empty.");

  const chunkSize = Math.max(250, Math.min(2000, Math.ceil(totalRows / 25)));
  /** @type {unknown[][]} */
  const allRows = [];
  let headers = /** @type {unknown[]} */ ([]);

  for (let startR = fullRange.s.r; startR <= fullRange.e.r; startR += chunkSize) {
    const endR = Math.min(startR + chunkSize - 1, fullRange.e.r);
    const chunkRange = {
      s: { r: startR, c: fullRange.s.c },
      e: { r: endR, c: fullRange.e.c },
    };
    const chunk = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
      raw: true,
      range: chunkRange,
    });

    if (startR === fullRange.s.r) {
      headers = chunk[0] ?? [];
      for (let i = 1; i < chunk.length; i++) allRows.push(chunk[i]);
    } else {
      for (let i = 0; i < chunk.length; i++) allRows.push(chunk[i]);
    }

    const rowsDone = endR - fullRange.s.r + 1;
    const rowPct = 35 + (rowsDone / totalRows) * 55;
    reportProgress(
      jobId,
      rowPct,
      `Parsing rows… ${Math.min(rowsDone, totalRows).toLocaleString()} / ${totalRows.toLocaleString()}`,
      "rows"
    );
  }

  if (!headers.length && !allRows.length) throw new Error("Sheet is empty.");

  reportProgress(jobId, 92, "Filtering empty rows…", "filter");
  const rows = allRows.filter((row) => row.some((c) => c != null && c !== ""));
  reportProgress(
    jobId,
    100,
    `Parsed ${rows.length.toLocaleString()} data rows`,
    "done"
  );

  return { headers, rows, sheetName };
}

self.onmessage = (event) => {
  const { jobId, buffer } = event.data ?? {};
  try {
    const parsed = parseExcelBuffer(buffer, jobId);
    self.postMessage({
      jobId,
      type: "done",
      headers: parsed.headers,
      rows: parsed.rows,
      sheetName: parsed.sheetName,
    });
  } catch (err) {
    self.postMessage({
      jobId,
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
