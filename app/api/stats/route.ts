import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// Ensure this route is dynamic
export const dynamic = "force-dynamic"

function readPeriodicFlushMinutes(): number {
  const raw = process.env.MODULEFETCH_PERIODIC_FLUSH_MINUTES?.trim()
  if (!raw) return 0
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function readBackgroundModuleMonitor(): boolean {
  const v = process.env.MODULEGAZE_BACKGROUND_MONITOR?.trim().toLowerCase()
  return v === "1" || v === "true" || v === "yes"
}

export async function GET() {
  const modulefetchPeriodicFlushMinutes = readPeriodicFlushMinutes()
  const backgroundModuleMonitor = readBackgroundModuleMonitor()
  try {
    // Read from your actual database structure
    const [totalModules, totalCategories] = await Promise.all([
      prisma.module.count({
        where: {
          enabled: true,
        },
      }),
      prisma.category.count({
        where: {
          enabled: true,
        },
      }),
    ])

    const stats = {
      totalModules,
      totalCategories,
      uniqueUsersToday: 0, // Will be updated by frontend from live sessions
      activeSessions: 0, // Will be updated by frontend from live sessions
      modulefetchPeriodicFlushMinutes,
      backgroundModuleMonitor,
    }

    return NextResponse.json(stats)
  } catch (error) {
    console.error("Error reading from database:", error)

    // Return zeros if can't connect - don't break the app
    return NextResponse.json({
      totalModules: 0,
      totalCategories: 0,
      uniqueUsersToday: 0,
      activeSessions: 0,
      modulefetchPeriodicFlushMinutes,
      backgroundModuleMonitor,
    })
  }
}
