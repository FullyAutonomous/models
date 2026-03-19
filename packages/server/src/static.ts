import path from "path";

/**
 * Resolves a URL pathname to an absolute file path within distDir.
 * Returns null if the resolved path escapes distDir (path traversal guard).
 */
export function safeResolvePath(distDir: string, pathname: string): string | null {
  // Guard against null-byte injection
  if (pathname.includes('\x00')) return null;

  // Strip leading slash; decode URI components
  let relative: string;
  try {
    relative = decodeURIComponent(pathname).replace(/^\//, "");
  } catch {
    return null;
  }

  const resolved = path.resolve(distDir, relative);

  // Guard: resolved path must start with distDir
  if (!resolved.startsWith(path.resolve(distDir) + path.sep) &&
      resolved !== path.resolve(distDir)) {
    return null;
  }

  return resolved;
}

/**
 * Serves a static file from distDir for the given URL pathname.
 * Returns a 404 Response if the file does not exist or path is unsafe.
 */
export async function serveStatic(
  distDir: string,
  pathname: string,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const filePath = safeResolvePath(distDir, pathname);
  if (!filePath) {
    return new Response("Not Found", { status: 404 });
  }

  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return new Response("Not Found", { status: 404 });
  }

  return new Response(file, {
    status: 200,
    headers: extraHeaders,
  });
}
