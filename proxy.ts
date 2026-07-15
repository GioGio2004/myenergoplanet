import { type NextRequest, NextResponse } from "next/server";

// Supported locales – extend as needed
const SUPPORTED_LOCALES = ["en", "ka"] as const;
const DEFAULT_LOCALE = "en" as const;

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip Next.js internals, static files, API routes, and the SW itself
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/sw.js") ||
    pathname.startsWith("/workbox-") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // Check if the first path segment is already a known locale
  const firstSegment = pathname.split("/")[1];
  const hasLocale = SUPPORTED_LOCALES.includes(
    firstSegment as (typeof SUPPORTED_LOCALES)[number],
  );

  if (!hasLocale) {
    // Rewrite (not redirect) so the URL bar stays clean at `/`
    // but Next.js router sees `/en` and matches `app/[locale]/page.tsx`
    const url = request.nextUrl.clone();
    url.pathname = `/${DEFAULT_LOCALE}${pathname}`;
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  // Run on every request except static assets handled by Next.js itself
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
