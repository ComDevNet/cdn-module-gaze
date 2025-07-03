import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// Ensure this route is dynamic
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    // Read modules with their categories using the updated schema
    const modules = await prisma.module.findMany({
      where: {
        enabled: true,
      },
      select: {
        id: true,
        name: true,
        description: true,
        language: true,
        indexHtmlUrl: true,
        logoUrl: true,
        categories: {
          select: {
            name: true,
            description: true,
          },
        },
      },
      orderBy: {
        name: "asc",
      },
    })

    return NextResponse.json(modules)
  } catch (error) {
    console.error("Error reading modules from database:", error)

    // Return empty array if can't connect
    return NextResponse.json([])
  }
}
