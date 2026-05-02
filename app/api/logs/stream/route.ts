import type { NextRequest } from "next/server"
import { subscribeJournalHubForSse } from "@/lib/oc4dJournalHub"

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
      let unsubscribeHub: (() => void) | null = null

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
        if (unsubscribeHub) {
          unsubscribeHub()
          unsubscribeHub = null
        }
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
        if (unsubscribeHub) {
          unsubscribeHub()
          unsubscribeHub = null
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

      console.log("🔍 SSE client subscribed to shared oc4d journal hub")

      unsubscribeHub = subscribeJournalHubForSse((line: string) => {
        console.log("📋 Module access detected:", line.substring(0, 100) + "...")

        const logData = JSON.stringify({
          line: line.trim(),
          timestamp: new Date().toISOString(),
        })

        safeEnqueue(encoder.encode(`data: ${logData}\n\n`))
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
