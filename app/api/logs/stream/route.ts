import type { NextRequest } from "next/server"
import { spawn, type ChildProcessWithoutNullStreams } from "child_process"
import { formatOc4dModuleAccessLogLine } from "@/lib/oc4dLogLine"

// Ensure this route is dynamic and not statically generated
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const MOCK_TICK_MS = 2500
const IDLE_KEEPALIVE_MS = 25_000

/** Only used when client explicitly requests `?mock=1` (demo / QA). */
const MOCK_SCENARIOS = [
  { ip: "10.0.0.12", username: "alice.nguyen", moduleSlug: "cdn_acid_bases_and_salts" },
  { ip: "10.0.0.13", username: "bob.kim", moduleSlug: "en-schools" },
  { ip: "10.0.0.14", username: "Guest", moduleSlug: "cdn_acid_bases_and_salts" },
  { ip: "10.0.0.12", username: "alice.nguyen", moduleSlug: "en-schools" },
  { ip: "192.168.50.2", username: "carlos.m", moduleSlug: "cdn_acid_bases_and_salts" },
] as const

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder()
  const useMock = request.nextUrl.searchParams.get("mock") === "1"

  const stream = new ReadableStream({
    start(controller) {
      let closed = false
      let backgroundTimer: ReturnType<typeof setInterval> | null = null
      /** `mock` = demo lines only; `idle` = no fake users, keepalive only; `null` = live journal only */
      let streamKind: null | "mock" | "idle" = null
      let logProcess: ChildProcessWithoutNullStreams | null = null

      const clearBackground = () => {
        if (backgroundTimer !== null) {
          clearInterval(backgroundTimer)
          backgroundTimer = null
        }
        streamKind = null
      }

      const safeClose = () => {
        if (closed) return
        closed = true
        clearBackground()
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }

      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return
        try {
          controller.enqueue(chunk)
        } catch {
          closed = true
        }
      }

      /** Explicit demo only — never used for “real” monitoring. */
      const startMockDemoStream = (reason: string) => {
        if (streamKind !== null) return
        streamKind = "mock"
        console.log(`📟 Mock demo log stream — ${reason}`)
        let i = 0
        const pushOne = () => {
          if (closed) return
          const row = MOCK_SCENARIOS[i % MOCK_SCENARIOS.length]
          i += 1
          const line = formatOc4dModuleAccessLogLine({
            ip: row.ip,
            username: row.username,
            moduleSlug: row.moduleSlug,
          })
          const logData = JSON.stringify({
            line,
            timestamp: new Date().toISOString(),
          })
          safeEnqueue(encoder.encode(`data: ${logData}\n\n`))
        }
        pushOne()
        backgroundTimer = setInterval(pushOne, MOCK_TICK_MS)
      }

      /**
       * No fabricated users: tell the client why, then comment keepalives only.
       * Table stays empty until real `data:` lines exist (Linux + journalctl).
       */
      const startIdleLogStream = (reason: string) => {
        if (streamKind !== null) return
        streamKind = "idle"
        console.log(`⏸ Log stream idle — ${reason}`)
        const payload = JSON.stringify({
          available: false,
          reason,
        })
        safeEnqueue(encoder.encode(`event: log-source\ndata: ${payload}\n\n`))
        backgroundTimer = setInterval(() => {
          safeEnqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`))
        }, IDLE_KEEPALIVE_MS)
      }

      const onClientAbort = () => {
        console.log("🛑 Client disconnected, stopping log stream")
        if (logProcess) {
          logProcess.kill("SIGTERM")
          logProcess = null
        }
        clearBackground()
        safeClose()
      }
      request.signal.addEventListener("abort", onClientAbort)

      if (useMock) {
        startMockDemoStream("client requested ?mock=1")
        return
      }

      if (process.platform === "win32") {
        startIdleLogStream(
          "journalctl is not available on Windows. Deploy on Linux with systemd for live oc4d logs, or enable “Demo log stream” for sample data only."
        )
        return
      }

      console.log("🔍 Starting to monitor oc4d.service logs (journalctl)...")

      logProcess = spawn("journalctl", [
        "-u",
        "oc4d.service",
        "-f",
        "--no-pager",
        "-o",
        "short-iso",
        "--since",
        "1 minute ago",
      ])

      logProcess.stdout.on("data", (data) => {
        const logLines = data
          .toString()
          .split("\n")
          .filter((line: string) => line.trim())

        logLines.forEach((line: string) => {
          if (line.includes("/modules/")) {
            console.log("📋 Module access detected:", line.substring(0, 100) + "...")

            const logData = JSON.stringify({
              line: line.trim(),
              timestamp: new Date().toISOString(),
            })

            safeEnqueue(encoder.encode(`data: ${logData}\n\n`))
          }
        })
      })

      logProcess.stderr.on("data", (data) => {
        console.error("Log monitoring error:", data.toString())
      })

      logProcess.on("close", (code) => {
        console.log(`Log monitoring process exited with code ${code}`)
        logProcess = null
        // Demo stream or idle keepalive: do not end the HTTP stream here.
        if (streamKind === "mock" || streamKind === "idle") return
        // After ENOENT, `close` can run before the `error` handler installs the idle stream; defer.
        setTimeout(() => {
          if (closed) return
          if (streamKind === "mock" || streamKind === "idle") return
          safeClose()
        }, 0)
      })

      logProcess.on("error", (error: NodeJS.ErrnoException) => {
        logProcess = null
        if (error.code === "ENOENT") {
          console.warn(
            "journalctl not found; opening idle stream (no synthetic users)."
          )
          startIdleLogStream(
            "journalctl was not found in PATH. Install systemd tools or run on the oc4d host. Enable “Demo log stream” only if you need sample rows."
          )
          return
        }
        console.error("Failed to start log monitoring:", error)
        safeClose()
      })
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET",
      "Access-Control-Allow-Headers": "Cache-Control",
    },
  })
}
