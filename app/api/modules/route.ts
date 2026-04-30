import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { extractModuleIdFromPath } from "@/lib/modulePath"
import {
  scanUploadsModulesLayout,
  type ScannedModuleRow,
} from "@/lib/scanUploadsModules"

// Ensure this route is dynamic
export const dynamic = "force-dynamic"

/**
 * Optional: absolute path to the `uploads/modules` directory on the server
 * (parent of `<buildId>/<slug>/index.html`). Merges discovered slugs with DB rows.
 * Example: `MODULEGAZE_UPLOADS_MODULES_ROOT=/var/www/oc4d.cdn/uploads/modules`
 */
export async function GET() {
  let dbModules: ScannedModuleRow[] = []
  try {
    dbModules = await prisma.module.findMany({
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
  } catch (error) {
    console.error("Error reading modules from database:", error)
  }

  const root = process.env.MODULEGAZE_UPLOADS_MODULES_ROOT?.trim()
  const scanned = root ? await scanUploadsModulesLayout(root) : []

  const dbSlugs = new Set(
    dbModules
      .map((m) => extractModuleIdFromPath(m.indexHtmlUrl))
      .filter((s): s is string => Boolean(s))
  )
  const extra = scanned.filter((s) => {
    const slug = extractModuleIdFromPath(s.indexHtmlUrl)
    return slug !== null && slug !== "" && !dbSlugs.has(slug)
  })

  const merged = [...dbModules, ...extra].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  )

  return NextResponse.json(merged)
}
