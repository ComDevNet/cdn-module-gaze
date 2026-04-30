import fs from "fs/promises";
import path from "path";

/** Shape aligned with `GET /api/modules` Prisma select. */
export type ScannedModuleRow = {
  id: string;
  name: string;
  description: string;
  language: string;
  indexHtmlUrl: string;
  logoUrl: string;
  categories: { name: string; description: string }[];
};

/**
 * Walk `rootDir` as oc4d-style `uploads/modules` on disk:
 * `<root>/<buildId>/<slug>/index.html` → `indexHtmlUrl` `/uploads/modules/<build>/<slug>/index.html`.
 * When the same slug appears under multiple builds, keep the newest build folder (mtime).
 */
export async function scanUploadsModulesLayout(
  rootDir: string
): Promise<ScannedModuleRow[]> {
  const abs = path.resolve(rootDir);
  try {
    await fs.access(abs);
  } catch {
    return [];
  }

  let buildEntries: import("fs").Dirent[];
  try {
    buildEntries = await fs.readdir(abs, { withFileTypes: true });
  } catch {
    return [];
  }

  const builds = buildEntries.filter((d) => d.isDirectory()).map((d) => d.name);
  const withMtime = await Promise.all(
    builds.map(async (build) => {
      const p = path.join(abs, build);
      try {
        const st = await fs.stat(p);
        return { build, mtime: st.mtimeMs };
      } catch {
        return { build, mtime: 0 };
      }
    })
  );
  withMtime.sort((a, b) => b.mtime - a.mtime);

  const bySlug = new Map<string, ScannedModuleRow>();

  for (const { build } of withMtime) {
    const buildPath = path.join(abs, build);
    let slugEntries: import("fs").Dirent[];
    try {
      slugEntries = await fs.readdir(buildPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of slugEntries) {
      if (!ent.isDirectory()) continue;
      const slug = ent.name;
      if (bySlug.has(slug)) continue;
      const indexPath = path.join(buildPath, slug, "index.html");
      try {
        await fs.access(indexPath);
      } catch {
        continue;
      }
      const indexHtmlUrl = `/uploads/modules/${build}/${slug}/index.html`;
      bySlug.set(slug, {
        id: `scan:${build}:${slug}`,
        name: slug,
        description: `Discovered on disk under ${abs}`,
        language: "en",
        indexHtmlUrl,
        logoUrl: "",
        categories: [],
      });
    }
  }

  return Array.from(bySlug.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
}
