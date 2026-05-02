/** Production default; override with MODULEFETCH_LOG_DIR. */
export const DEFAULT_MODULEFETCH_DIR = "/var/log/modulegaze";

export const MODULEGAZE_ACCESS_LOG_NAME = "modulegaze-access.log";

export function getModuleFetchDir(): string {
  const fromEnv = process.env.MODULEFETCH_LOG_DIR?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_MODULEFETCH_DIR;
}
