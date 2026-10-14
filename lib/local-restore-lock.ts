import { AsyncLocalStorage } from "node:async_hooks";

declare global {
  var _paymentsInFlight: Set<symbol> | undefined;
  var _localRestoreActive: boolean | undefined;
  var _localRestoreContext: AsyncLocalStorage<boolean> | undefined;
}

if (!global._localRestoreContext) global._localRestoreContext = new AsyncLocalStorage<boolean>();
const restoreContext = global._localRestoreContext;

export class LocalRestoreBusyError extends Error {
  readonly code = "LOCAL_RESTORE_BUSY";

  constructor(message = "A local restore is in progress. Try again after it finishes.") {
    super(message);
    this.name = "LocalRestoreBusyError";
  }
}

export function isLocalRestoreActive(): boolean {
  return global._localRestoreActive === true;
}

export function isLocalDataBlocked(): boolean {
  return isLocalRestoreActive() && restoreContext.getStore() !== true;
}

/** Same-process exclusion for the single SQLite server; the maintenance context retains DB access. */
export async function withLocalRestoreLock<T>(operation: () => Promise<T>): Promise<T> {
  if (isLocalRestoreActive()) throw new LocalRestoreBusyError();
  if (global._keyScanLoop?.running || global._keyScanLoop?.dirty || global._keyScanLoop?.activeWorkers.size) {
    throw new LocalRestoreBusyError("The key scanner is active or has an unpersisted checkpoint. Stop it before restoring.");
  }
  if (global._paymentsInFlight?.size || global._localBackupDraining || global._autoSendExecutingGroups?.size ||
      global._autoSendRunningGroups?.size || global._autoSendLoggingGroups?.size || global._tieredRewardsRunningConfigs?.size ||
      global._tieredRewardsSchedulingConfigs?.size) {
    throw new LocalRestoreBusyError("A backup sync or payment run is active. Wait for it to finish before restoring.");
  }
  global._localRestoreActive = true;
  try {
    return await restoreContext.run(true, operation);
  } finally {
    global._localRestoreActive = false;
  }
}
