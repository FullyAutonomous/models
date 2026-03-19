import path from "path";

export type ModelRecord = Record<string, unknown>;
export type ProviderRecord = {
  id: string;
  name: string;
  models: Record<string, ModelRecord>;
};
export type ProvidersMap = Record<string, ProviderRecord>;

let cache: ProvidersMap | null = null;

export async function getProviders(distDir: string): Promise<ProvidersMap> {
  if (!cache) {
    const file = Bun.file(path.join(distDir, "_api.json"));
    cache = await file.json();
  }
  return cache!;
}

/** Call between tests to clear the in-memory cache */
export function resetCache(): void {
  cache = null;
}
