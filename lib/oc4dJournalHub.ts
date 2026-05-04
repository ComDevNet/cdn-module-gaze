type LineHandler = (line: string) => void;

type HubChild = import("child_process").ChildProcessWithoutNullStreams;

const sseHandlers = new Set<LineHandler>();
const internalHandlers = new Set<LineHandler>();

let logProcess: HubChild | null = null;
/** Avoid overlapping spawns while `child_process` is loading asynchronously. */
let journalSpawnInFlight = false;
/** When true, keep `journalctl` running even if no SSE clients are connected. */
let backgroundPinned = false;

function resolveJournalSinceArg(): string | null {
  const raw = process.env.MODULEGAZE_JOURNAL_SINCE?.trim();
  if (!raw) return "today";
  const lowered = raw.toLowerCase();
  if (lowered === "all" || lowered === "none" || lowered === "disable") {
    return null;
  }
  return raw;
}

function isModuleLine(line: string): boolean {
  return (
    line.includes("/modules/") || line.includes("/uploads/modules/")
  );
}

/** Runtime-only load so Webpack does not parse `fs` when bundling `instrumentation.ts`. */
function appendAccessLogTee(line: string): void {
  void import(
    /* webpackIgnore: true */
    "./moduleFetchAccessLog"
  )
    .then((m) => m.appendModulegazeAccessLogLine(line))
    .catch((err) => console.error("[modulegaze] access log tee failed:", err));
}

function dispatchLine(raw: string): void {
  const line = raw.trim();
  if (!line || !isModuleLine(line)) return;
  appendAccessLogTee(line);
  for (const h of internalHandlers) {
    try {
      h(line);
    } catch (e) {
      console.error("[oc4dJournalHub] internal handler error:", e);
    }
  }
  for (const h of sseHandlers) {
    try {
      h(line);
    } catch (e) {
      console.error("[oc4dJournalHub] subscriber error:", e);
    }
  }
}

function stopHubProcess(): void {
  if (logProcess) {
    logProcess.kill("SIGTERM");
    logProcess = null;
  }
}

function maybeStopHubProcess(): void {
  if (backgroundPinned) return;
  if (sseHandlers.size > 0 || internalHandlers.size > 0) return;
  stopHubProcess();
}

function wireJournalctlProcess(proc: HubChild): void {
  proc.stdout.on("data", (data: Buffer) => {
    const chunks = data
      .toString()
      .split("\n")
      .filter((l: string) => l.trim());
    for (const chunk of chunks) {
      dispatchLine(chunk);
    }
  });

  proc.stderr.on("data", (data: Buffer) => {
    console.error("[oc4dJournalHub] journalctl stderr:", data.toString());
  });

  proc.on("close", (code) => {
    console.log(`[oc4dJournalHub] journalctl exited code ${code ?? "?"}`);
    logProcess = null;
    if (backgroundPinned || sseHandlers.size > 0 || internalHandlers.size > 0) {
      setTimeout(() => startHubProcessIfNeeded(), 3000);
    }
  });

  proc.on("error", (err: NodeJS.ErrnoException) => {
    console.error("[oc4dJournalHub] journalctl spawn error:", err);
    logProcess = null;
    if (err.code === "ENOENT") {
      console.warn("[oc4dJournalHub] journalctl not in PATH");
    }
  });
}

function startHubProcessIfNeeded(): void {
  if (process.platform === "win32") return;
  if (logProcess || journalSpawnInFlight) return;
  if (sseHandlers.size === 0 && internalHandlers.size === 0 && !backgroundPinned) {
    return;
  }

  journalSpawnInFlight = true;
  void import(/* webpackIgnore: true */ "child_process")
    .then(({ spawn }) => {
      journalSpawnInFlight = false;
      if (logProcess) return;
      if (process.platform === "win32") return;
      if (sseHandlers.size === 0 && internalHandlers.size === 0 && !backgroundPinned) {
        return;
      }

      const sinceArg = resolveJournalSinceArg();
      const args = ["-u", "oc4d.service", "-f", "--no-pager", "-o", "short-iso"];
      if (sinceArg) {
        args.push("--since", sinceArg);
      }
      console.log(
        `🔍 oc4dJournalHub: starting journalctl -u oc4d.service -f ${
          sinceArg ? `--since "${sinceArg}"` : "(full history mode)"
        } …`
      );

      const proc = spawn("journalctl", args) as HubChild;

      logProcess = proc;
      wireJournalctlProcess(proc);
    })
    .catch((err) => {
      journalSpawnInFlight = false;
      console.error("[oc4dJournalHub] child_process load failed:", err);
    });
}

export function setJournalHubBackgroundPinned(pinned: boolean): void {
  backgroundPinned = pinned;
  if (pinned) {
    startHubProcessIfNeeded();
  } else {
    maybeStopHubProcess();
  }
}

export function registerJournalHubInternalHandler(handler: LineHandler): () => void {
  internalHandlers.add(handler);
  startHubProcessIfNeeded();
  return () => {
    internalHandlers.delete(handler);
    maybeStopHubProcess();
  };
}

/** One subscriber per SSE connection; unsubscribes on disconnect. */
export function subscribeJournalHubForSse(handler: LineHandler): () => void {
  sseHandlers.add(handler);
  startHubProcessIfNeeded();
  return () => {
    sseHandlers.delete(handler);
    maybeStopHubProcess();
  };
}
