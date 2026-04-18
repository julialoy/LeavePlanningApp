import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { User } from '@supabase/supabase-js'

/**
 * Refreshes the Supabase session on every non-static/non-API request and
 * enforces route-level auth:
 * - Unauthenticated users hitting / or /dashboard/* are redirected to sign-in.
 * - Authenticated users hitting /auth/* are redirected to the dashboard.
 * - Supabase connectivity failures return a 503 rather than silently redirecting.
 *
 * Uses getUser() over getSession() — getSession() reads the JWT from the cookie
 * without server-side validation and can be spoofed.
 */
export async function middleware(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing required env vars: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.'
    )
  }

  // supabaseResponse carries refreshed session cookies. All return paths must
  // either return this object or copy its cookies onto their own response —
  // otherwise the session will silently expire.
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      // Rebuild supabaseResponse each time @supabase/ssr writes cookies so
      // the updated session reaches the browser.
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        supabaseResponse = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        )
      },
    },
  })

  let user: User | null = null
  try {
    const { data, error } = await supabase.auth.getUser()
    // AuthSessionMissingError is expected for unauthenticated users — not a fault
    if (error && error.name !== 'AuthSessionMissingError') {
      throw error
    }
    user = data.user
  } catch {
    return new NextResponse(
      `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Service Unavailable</title></head>
<body>
  <h1>Service Temporarily Unavailable</h1>
  <p>Unable to connect to the authentication service. Please try again in a moment.</p>
</body>
</html>`,
      { status: 503, headers: { 'Content-Type': 'text/html' } }
    )
  }

  const { pathname } = request.nextUrl
  const isProtectedRoute = pathname === '/' || pathname.startsWith('/dashboard')
  const isAuthRoute = pathname.startsWith('/auth')

  if (!user && isProtectedRoute) {
    return redirectWithCookies(request.nextUrl.clone(), '/auth/sign-in', supabaseResponse)
  }

  if (user && isAuthRoute) {
    return redirectWithCookies(request.nextUrl.clone(), '/dashboard', supabaseResponse)
  }

  return supabaseResponse
}

// Copies refreshed session cookies onto a redirect response so tokens aren't
// dropped when the user is bounced between routes.
function redirectWithCookies(
  url: URL,
  pathname: string,
  sessionResponse: NextResponse
): NextResponse {
  url.pathname = pathname
  const response = NextResponse.redirect(url)
  sessionResponse.cookies.getAll().forEach(({ name, value, ...attributes }) =>
    response.cookies.set(name, value, attributes)
  )
  return response
}

// Exclude Next.js internals, API routes, and static assets from middleware.
export const config = {
  matcher: [
    '/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
