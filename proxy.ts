import { clerkMiddleware } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";

// Supported locales – extend as needed
const SUPPORTED_LOCALES = ["en", "ka"] as const;
const DEFAULT_LOCALE = "en" as const;

function localeRewrite(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip Next.js internals, static files, API routes, Clerk's proxy, and the SW itself
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/__clerk") ||
    pathname.startsWith("/sign-in") ||
    pathname.startsWith("/sign-up") ||
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

export const proxy = clerkMiddleware((_auth, request) => {
  return localeRewrite(request);
});

export const config = {
  // Run on every request except static assets handled by Next.js itself
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
