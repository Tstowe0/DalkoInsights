/* Module worker — runs aggregations off the UI thread */
import { runAnalysis } from "../analytics/engine.js";

self.onmessage = (event) => {
  const { jobId, rows, maps, headers } = event.data ?? {};
  try {
    self.postMessage({
      jobId,
      type: "progress",
      message: `Analyzing ${Array.isArray(rows) ? rows.length.toLocaleString() : 0} rows…`,
    });
    const results = runAnalysis(rows, maps, headers);
    self.postMessage({ jobId, type: "done", results });
  } catch (err) {
    self.postMessage({
      jobId,
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
