import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { extractModuleIdFromPath } from "@/lib/modulePath"
import {
  scanUploadsModulesLayout,
  type ScannedModuleRow,
} from "@/lib/scanUploadsModules"

// Ensure this route is dynamic
export const dynamic = "force-dynamic"

type ModulesApiResponse = {
  modules: ScannedModuleRow[]
  sources: {
    mergedCount: number
    database: {
      ok: boolean
      count: number
      error: string | null
    }
    scan: {
      enabled: boolean
      root: string | null
      rootsTried: string[]
      count: number
    }
  }
  warnings: string[]
}

const DEFAULT_UPLOADS_MODULES_ROOTS = [
  "/oc4d-server/workspaces/website/uploads/modules",
  "/var/www/oc4d.cdn/uploads/modules",
]

/**
 * Optional: absolute path to the `uploads/modules` directory on the server
 * (parent of `<buildId>/<slug>/index.html`). Merges discovered slugs with DB rows.
 * Example: `MODULEGAZE_UPLOADS_MODULES_ROOT=/var/www/oc4d.cdn/uploads/modules`
 */
export async function GET() {
  let dbModules: ScannedModuleRow[] = []
  let dbError: string | null = null
  try {
    dbModules = await prisma.module.findMany({
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
    dbError = error instanceof Error ? error.message : String(error)
    console.error("Error reading modules from database:", error)
  }

  const configuredRoot = process.env.MODULEGAZE_UPLOADS_MODULES_ROOT?.trim()
  const rootsTried = configuredRoot
    ? [configuredRoot]
    : DEFAULT_UPLOADS_MODULES_ROOTS

  const scannedBySlug = new Map<string, ScannedModuleRow>()
  for (const rootCandidate of rootsTried) {
    const rows = await scanUploadsModulesLayout(rootCandidate)
    for (const row of rows) {
      const slug = extractModuleIdFromPath(row.indexHtmlUrl)
      const key = slug && slug.length > 0 ? slug : row.id
      if (!scannedBySlug.has(key)) {
        scannedBySlug.set(key, row)
      }
    }
  }
  const scanned = Array.from(scannedBySlug.values())

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

  const warnings: string[] = []
  if (dbError) {
    warnings.push("Database module lookup failed; fallback sources may be incomplete.")
  }
  if (configuredRoot && scanned.length === 0) {
    warnings.push(
      `No modules were found under MODULEGAZE_UPLOADS_MODULES_ROOT (${configuredRoot}).`
    )
  }
  if (merged.length === 0) {
    warnings.push("No modules were discovered from database or disk scan sources.")
  }

  const payload: ModulesApiResponse = {
    modules: merged,
    sources: {
      mergedCount: merged.length,
      database: {
        ok: !dbError,
        count: dbModules.length,
        error: dbError,
      },
      scan: {
        enabled: rootsTried.length > 0,
        root: configuredRoot ?? rootsTried[0] ?? null,
        rootsTried,
        count: scanned.length,
      },
    },
    warnings,
  }

  return NextResponse.json(payload)
}
