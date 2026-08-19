/**
 * Shared builders for client dump / tracking style reports.
 */
import {
  ensureXlsx,
  readFileBuffer,
  workbookToObjects,
  downloadWorkbook,
  readCellA1,
} from "./excel.js";
import { applyClientReportStyle, rowsToSheetWorkbook, XL } from "./report-format.js";
import {
  pickVal,
  parseDate,
  prevSunSat,
  prevMonthRange,
  fmtMDY,
  fmtShort,
  startOfDay,
} from "./report-helpers.js";
import {
  buildTrackingLayout,
  highlightMap,
  VETPET_EXCLUDE,
  todayNy,
} from "./tracking-layout.js";
import { mountFileTool } from "./file-ui.js";

/**
 * Dump-style report with optional filters + Python-parity styling.
 * @param {object} cfg
 * @param {HTMLElement} parent
 * @param {{ onBack: () => void, log: (msg: string) => void }} ctx
 */
export function mountDumpFilterReport(parent, ctx, cfg) {
  const {
    title,
    category,
    instructions,
    clientIncludes = [],
    dateField = "ACTUAL SHIP DATE",
    dateMode = "none", // prevWeek | prevMonth | none — match Python (often none)
    equipmentIncludes = null,
    equipmentExcludes = null,
    tlOnly = false,
    renameMap = {},
    keepColumns = null,
    filename,
    sheetName = "Data",
    transformRows = null,
    buildWorkbook = null,
    styleOpts = null,
    emailDraft = null,
    requireClientNameA1 = true,
  } = cfg;

  mountFileTool(parent, {
    title,
    category,
    instructions,
    onBack: ctx.onBack,
    log: ctx.log,
    emailDraft,
    async onRun(files, ui) {
      await ensureXlsx();
      const buffer = await readFileBuffer(files[0]);
      if (requireClientNameA1 && readCellA1(buffer).toUpperCase() !== "CLIENT NAME") {
        const ok = window.confirm(
          "Cell A1 is not CLIENT NAME — this may not be a TMS Data Dump.\n\nClick OK to run anyway, or Cancel to abort."
        );
        if (!ok) {
          ui.setStatus("Ready");
          ctx.log(`${title}: aborted (A1 check).`);
          return;
        }
        ctx.log("Warning: A1 may not be CLIENT NAME — continuing after confirm.");
      }

      if (buildWorkbook) {
        const { workbook, name, rowCount } = await buildWorkbook(buffer, {
          sun: prevSunSat().sun,
          sat: prevSunSat().sat,
          monthLabel: prevMonthRange().label,
          fmtMDY,
          fmtShort,
          log: ctx.log,
        });
        downloadWorkbook(workbook, name);
        ui.setStatus("Complete");
        ctx.log(`${title}: ${rowCount.toLocaleString()} rows → ${name}`);
        return;
      }

      let { rows, headers: sourceHeaders } = workbookToObjects(buffer);

      if (clientIncludes.length) {
        rows = rows.filter((r) => {
          const client = String(pickVal(r, ["CLIENT NAME"]) ?? "").toUpperCase();
          return clientIncludes.some((c) => client.includes(String(c).toUpperCase()));
        });
      }

      if (dateMode === "prevWeek") {
        const { sun, sat } = prevSunSat();
        rows = rows.filter((r) => {
          const d = parseDate(pickVal(r, [dateField, "EXPECTED SHIP DATE", "INVOICE DATE"]));
          if (!d) return false;
          const t = startOfDay(d).getTime();
          return t >= sun.getTime() && t <= sat.getTime();
        });
      } else if (dateMode === "prevMonth") {
        const { first, last } = prevMonthRange();
        rows = rows.filter((r) => {
          const d = parseDate(pickVal(r, [dateField, "INVOICE DATE", "ACTUAL SHIP DATE"]));
          if (!d) return false;
          const t = startOfDay(d).getTime();
          return t >= first.getTime() && t <= last.getTime();
        });
      }

      if (tlOnly) {
        rows = rows.filter((r) => /TL|TRUCKLOAD/i.test(String(pickVal(r, ["EQUIPMENT", "MODE"]) ?? "")));
      }
      if (equipmentIncludes) {
        rows = rows.filter((r) =>
          equipmentIncludes.some((x) =>
            String(pickVal(r, ["EQUIPMENT"]) ?? "")
              .toUpperCase()
              .includes(String(x).toUpperCase())
          )
        );
      }
      if (equipmentExcludes) {
        rows = rows.filter(
          (r) =>
            !equipmentExcludes.some((x) =>
              String(pickVal(r, ["EQUIPMENT"]) ?? "")
                .toUpperCase()
                .includes(String(x).toUpperCase())
            )
        );
      }

      if (transformRows) rows = transformRows(rows);

      let out = rows.map((row) => {
        /** @type {Record<string, unknown>} */
        const next = {};
        if (keepColumns) {
          for (const k of keepColumns) {
            const srcKey = Object.entries(renameMap).find(([, v]) => v === k)?.[0] || k;
            next[k] = row[srcKey] ?? row[k] ?? "";
          }
          return next;
        }
        for (const [k, v] of Object.entries(row)) {
          const dest = renameMap[k] || k;
          next[dest] = v;
        }
        return next;
      });

      if (keepColumns) {
        out = out.map((row) => {
          /** @type {Record<string, unknown>} */
          const ordered = {};
          for (const k of keepColumns) ordered[k] = row[k] ?? "";
          return ordered;
        });
      }

      const { sun, sat } = prevSunSat();
      const { label: monthLabel } = prevMonthRange();
      const name =
        typeof filename === "function"
          ? filename({ sun, sat, monthLabel, fmtMDY, fmtShort })
          : filename;
      const headers =
        keepColumns ||
        (out[0] ? Object.keys(out[0]) : sourceHeaders.length ? sourceHeaders : []);
      const wb = rowsToSheetWorkbook(out, String(sheetName).slice(0, 31), headers);
      const ctxStyle = { sun, sat, monthLabel, fmtMDY, fmtShort };
      const resolvedStyle =
        typeof styleOpts === "function" ? styleOpts(ctxStyle) : styleOpts || {};
      applyClientReportStyle(wb, {
        headerFill: XL.HEADER,
        zebraGrey: XL.ZEBRA_DUMP,
        zebraWhite: XL.WHITE,
        zebra: true,
        autosizePad: 2,
        ...resolvedStyle,
      });
      downloadWorkbook(wb, name);
      ui.setStatus("Complete");
      ctx.log(`${title}: ${out.length.toLocaleString()} rows → ${name}`);
    },
  });
}

/**
 * Tracking daily report (Vet-Pet / FCA / McConway pipeline).
 * @param {object} cfg
 * @param {HTMLElement} parent
 * @param {{ onBack: () => void, log: (msg: string) => void }} ctx
 */
export function mountTrackingDailyReport(parent, ctx, cfg) {
  const {
    title,
    category,
    instructions,
    excludeStatuses = VETPET_EXCLUDE,
    ltlExact = false,
    dropPickupAndClient = false,
    highlight = true,
    filename,
    sheetName,
    emailDraft = null,
  } = cfg;

  mountFileTool(parent, {
    title,
    category,
    instructions,
    onBack: ctx.onBack,
    log: ctx.log,
    emailDraft,
    async onRun(files, ui) {
      await ensureXlsx();
      const buffer = await readFileBuffer(files[0]);
      const a1 = readCellA1(buffer).toUpperCase();
      if (a1 !== "CLIENT") {
        const ok = window.confirm(
          "Cell A1 is not Client — this may not be a Tracking Report.\n\nClick OK to run anyway, or Cancel to abort."
        );
        if (!ok) {
          ui.setStatus("Ready");
          ctx.log(`${title}: aborted (A1 check).`);
          return;
        }
        ctx.log("Warning: A1 may not be a Tracking Report header — continuing after confirm.");
      }
      const { rows, headers: sourceHeaders } = workbookToObjects(buffer, { asText: true });
      const built = buildTrackingLayout(rows, {
        excludeStatuses,
        ltlExact,
        dropPickupAndClient,
        highlight,
        sourceHeaders,
      });

      const today = todayNy();
      const name =
        typeof filename === "function" ? filename({ today, fmtMDY }) : filename;
      const sheet =
        typeof sheetName === "function"
          ? sheetName({ today, fmtMDY })
          : sheetName || `Daily Shipments for ${fmtMDY(today)}`;

      const headers = built.rows[0]
        ? Object.keys(built.rows[0])
        : built.headers?.length
          ? built.headers
          : sourceHeaders;
      const wb = rowsToSheetWorkbook(built.rows, String(sheet).slice(0, 31), headers);

      /** @type {import("./report-format.js").ReportStyleOpts} */
      const style = {
        headerFill: XL.HEADER,
        zebraGrey: XL.ZEBRA_TRACK,
        zebraWhite: XL.WHITE,
        zebra: true,
        wrap: true,
        fixedColWidth: 20,
      };

      if (highlight && built.expCol) {
        const colIdx = headers.findIndex((h) => h === built.expCol);
        if (colIdx >= 0) {
          style.cellHighlights = {
            col: colIdx,
            rows: highlightMap(built.todayRows, built.lateRows),
          };
        }
      }

      applyClientReportStyle(wb, style);
      downloadWorkbook(wb, name);
      ui.setStatus("Complete");
      ctx.log(`${title}: ${built.rows.length.toLocaleString()} rows → ${name}`);
    },
  });
}
