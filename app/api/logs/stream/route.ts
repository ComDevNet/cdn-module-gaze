import type { NextRequest } from "next/server"
import { spawn } from "child_process"

// Ensure this route is dynamic and not statically generated
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      console.log("🔍 Starting to monitor oc4d.service logs...")

      // Monitor the actual oc4d.service logs
      const logProcess = spawn("journalctl", [
        "-u",
        "oc4d.service", // Your existing service
        "-f", // Follow (tail) the logs
        "--no-pager", // Don't use pager
        "-o",
        "short-iso", // Output format with ISO timestamps
        "--since",
        "1 minute ago", // Start from recent logs
      ])

      logProcess.stdout.on("data", (data) => {
        const logLines = data
          .toString()
          .split("\n")
          .filter((line: string) => line.trim())

        logLines.forEach((line: string) => {
          // Only send lines that contain "/modules/" - these are the requests we care about
          if (line.includes("/modules/")) {
            console.log("📋 Module access detected:", line.substring(0, 100) + "...")

            const logData = JSON.stringify({
              line: line.trim(),
              timestamp: new Date().toISOString(),
            })

            controller.enqueue(encoder.encode(`data: ${logData}\n\n`))
          }
        })
      })

      logProcess.stderr.on("data", (data) => {
        console.error("Log monitoring error:", data.toString())
      })

      logProcess.on("close", (code) => {
        console.log(`Log monitoring process exited with code ${code}`)
        controller.close()
      })

      logProcess.on("error", (error) => {
        console.error("Failed to start log monitoring:", error)
        controller.close()
      })

      // Clean up when client disconnects
      request.signal.addEventListener("abort", () => {
        console.log("🛑 Client disconnected, stopping log monitoring")
        logProcess.kill("SIGTERM")
        controller.close()
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
