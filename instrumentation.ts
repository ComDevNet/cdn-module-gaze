export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { refreshUserPoolCache } = await import("@/lib/userPoolCache");
  void refreshUserPoolCache(true);
  const { enableBackgroundModuleMonitor } = await import(
    "@/lib/serverBackgroundModuleMonitor"
  );
  enableBackgroundModuleMonitor();
}
