/**
 * Worker job helpers — generation tokens ignore stale responses.
 */

let jobSeq = 0;

/** @returns {number} */
export function nextJobId() {
  return ++jobSeq;
}

/**
 * @template T
 * @param {Worker} worker
 * @param {number} jobId
 * @param {unknown} payload
 * @param {Transferable[]} [transfer]
 * @param {(msg: { type?: string, message?: string, phase?: string }) => void} [onProgress]
 * @returns {Promise<T>}
 */
export function workerJob(worker, jobId, payload, transfer = [], onProgress) {
  return new Promise((resolve, reject) => {
    /** @param {MessageEvent} event */
    const onMessage = (event) => {
      const data = event.data;
      if (!data || data.jobId !== jobId) return;
      if (data.type === "progress") {
        onProgress?.(data);
        return;
      }
      cleanup();
      if (data.type === "error") {
        reject(new Error(data.message || "Worker failed."));
        return;
      }
      if (data.type === "done") {
        resolve(/** @type {T} */ (data));
        return;
      }
      reject(new Error("Unexpected worker response."));
    };

    /** @param {ErrorEvent} event */
    const onError = (event) => {
      cleanup();
      reject(event.error ?? new Error(event.message || "Worker crashed."));
    };

    function cleanup() {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
    }

    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.postMessage({ jobId, .../** @type {object} */ (payload) }, transfer);
  });
}
