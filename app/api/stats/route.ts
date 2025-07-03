import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// Ensure this route is dynamic
export const dynamic = "force-dynamic"

export async function GET() {
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
    })
  }
}
