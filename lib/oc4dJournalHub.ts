type LineHandler = (line: string) => void;

type HubChild = import("child_process").ChildProcessWithoutNullStreams;

/**
 * Shared journal-hub state.
 *
 * Without `globalThis` pinning, Next.js bundles `instrumentation.ts` and
 * the route handlers into separate chunks; each gets its own copy of the
 * module-scoped sets/flags below, so the SSE endpoint and the background
 * monitor would each spawn their own `journalctl -f` process and never
 * see each other's subscribers. Pinning the state to `globalThis` keeps
 * one hub for the whole Next.js process (same trick as `lib/prisma.ts`).
 */
type HubState = {
  sseHandlers: Set<LineHandler>;
  internalHandlers: Set<LineHandler>;
  logProcess: HubChild | null;
  /** Avoid overlapping spawns while `child_process` is loading asynchronously. */
  journalSpawnInFlight: boolean;
  /** When true, keep `journalctl` running even if no SSE clients are connected. */
  backgroundPinned: boolean;
};

const HUB_STATE_KEY = Symbol.for("cdnModuleGaze.oc4dJournalHub.state");
const globalForHub = globalThis as unknown as {
  [HUB_STATE_KEY]?: HubState;
};
const hub: HubState =
  globalForHub[HUB_STATE_KEY] ?? {
    sseHandlers: new Set<LineHandler>(),
    internalHandlers: new Set<LineHandler>(),
    logProcess: null,
    journalSpawnInFlight: false,
    backgroundPinned: false,
  };
globalForHub[HUB_STATE_KEY] = hub;

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

/**
 * Append the line to the daily-rotated modulegaze access log when
 * `MODULEGAZE_TEE_ACCESS_LOG=1`. Plain dynamic import so webpack creates a
 * proper chunk; the previous `webpackIgnore: true` made the literal
 * "./moduleFetchAccessLog" string survive into the compiled chunk and
 * bun then failed to resolve it (`ERR_MODULE_NOT_FOUND`).
 */
function appendAccessLogTee(line: string): void {
  void import("./moduleFetchAccessLog")
    .then((m) => m.appendModulegazeAccessLogLine(line))
    .catch((err) =>
      console.error("[modulegaze] access log tee failed:", err)
    );
}

function dispatchLine(raw: string): void {
  const line = raw.trim();
  if (!line || !isModuleLine(line)) return;
  appendAccessLogTee(line);
  for (const h of hub.internalHandlers) {
    try {
      h(line);
    } catch (e) {
      console.error("[oc4dJournalHub] internal handler error:", e);
    }
  }
  for (const h of hub.sseHandlers) {
    try {
      h(line);
    } catch (e) {
      console.error("[oc4dJournalHub] subscriber error:", e);
    }
  }
}

function stopHubProcess(): void {
  if (hub.logProcess) {
    hub.logProcess.kill("SIGTERM");
    hub.logProcess = null;
  }
}

function maybeStopHubProcess(): void {
  if (hub.backgroundPinned) return;
  if (hub.sseHandlers.size > 0 || hub.internalHandlers.size > 0) return;
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
    hub.logProcess = null;
    if (
      hub.backgroundPinned ||
      hub.sseHandlers.size > 0 ||
      hub.internalHandlers.size > 0
    ) {
      setTimeout(() => startHubProcessIfNeeded(), 3000);
    }
  });

  proc.on("error", (err: NodeJS.ErrnoException) => {
    console.error("[oc4dJournalHub] journalctl spawn error:", err);
    hub.logProcess = null;
    if (err.code === "ENOENT") {
      console.warn("[oc4dJournalHub] journalctl not in PATH");
    }
  });
}

function startHubProcessIfNeeded(): void {
  if (process.platform === "win32") return;
  if (hub.logProcess || hub.journalSpawnInFlight) return;
  if (
    hub.sseHandlers.size === 0 &&
    hub.internalHandlers.size === 0 &&
    !hub.backgroundPinned
  ) {
    return;
  }

  hub.journalSpawnInFlight = true;
  // Keep `webpackIgnore` here: `child_process` is a Node built-in that
  // bun resolves natively; we don't want webpack mocking it.
  void import(/* webpackIgnore: true */ "child_process")
    .then(({ spawn }) => {
      hub.journalSpawnInFlight = false;
      if (hub.logProcess) return;
      if (process.platform === "win32") return;
      if (
        hub.sseHandlers.size === 0 &&
        hub.internalHandlers.size === 0 &&
        !hub.backgroundPinned
      ) {
        return;
      }

      const sinceArg = resolveJournalSinceArg();
      const args = [
        "-u",
        "oc4d.service",
        "-f",
        "--no-pager",
        "-o",
        "short-iso",
      ];
      if (sinceArg) {
        args.push("--since", sinceArg);
      }
      console.log(
        `🔍 oc4dJournalHub: starting journalctl -u oc4d.service -f ${
          sinceArg ? `--since "${sinceArg}"` : "(full history mode)"
        } …`
      );

      const proc = spawn("journalctl", args) as HubChild;

      hub.logProcess = proc;
      wireJournalctlProcess(proc);
    })
    .catch((err) => {
      hub.journalSpawnInFlight = false;
      console.error("[oc4dJournalHub] child_process load failed:", err);
    });
}

export function setJournalHubBackgroundPinned(pinned: boolean): void {
  hub.backgroundPinned = pinned;
  if (pinned) {
    startHubProcessIfNeeded();
  } else {
    maybeStopHubProcess();
  }
}

export function registerJournalHubInternalHandler(
  handler: LineHandler
): () => void {
  hub.internalHandlers.add(handler);
  startHubProcessIfNeeded();
  return () => {
    hub.internalHandlers.delete(handler);
    maybeStopHubProcess();
  };
}

/** One subscriber per SSE connection; unsubscribes on disconnect. */
export function subscribeJournalHubForSse(handler: LineHandler): () => void {
  hub.sseHandlers.add(handler);
  startHubProcessIfNeeded();
  return () => {
    hub.sseHandlers.delete(handler);
    maybeStopHubProcess();
  };
}
