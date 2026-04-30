import type { NextRequest } from "next/server"
import { spawn, type ChildProcessWithoutNullStreams } from "child_process"

// Ensure this route is dynamic and not statically generated
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const IDLE_KEEPALIVE_MS = 25_000

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      let closed = false
      let backgroundTimer: ReturnType<typeof setInterval> | null = null
      /** `idle` = no journal, keepalive only; `null` = live journal */
      let streamKind: null | "idle" = null
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

      if (process.platform === "win32") {
        startIdleLogStream(
          "journalctl is not available on Windows. Run this app on your Linux oc4d host to stream live oc4d.service logs."
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
          if (line.includes("/modules/") || line.includes("/uploads/modules/")) {
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
        if (streamKind === "idle") return
        setTimeout(() => {
          if (closed) return
          if (streamKind === "idle") return
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
            "journalctl was not found in PATH. Install systemd journal tools or run on the oc4d server that ships oc4d logs."
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
