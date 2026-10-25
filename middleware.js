// ===== Protects the dashboard and the two new data routes with the login =====
// GitHub path: middleware.js  (existing file: replace everything)
import { NextResponse } from 'next/server'
import { verifySessionToken } from './app/lib/dashboardauth'

// Protects /dashboard and the data it loads. Without this, anyone with the
// URL could see every trader's real name, phone number and savings amount.
//
// The login cookie now holds a signed token (see app/lib/dashboardauth.js),
// so it can't be faked by typing a cookie by hand.
export async function middleware(request) {
  const token = request.cookies.get('myajo_dashboard_auth')?.value
  const valid = await verifySessionToken(token, process.env.DASHBOARD_PASSWORD)

  if (valid) {
    return NextResponse.next()
  }

  // Data requests get a plain "not allowed" answer; page visits are sent
  // to the login page.
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const loginUrl = new URL('/dashboard-login', request.url)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: [
    '/dashboard',
    '/dashboard/:path*',
    '/api/dashboard-data',
    '/api/dashboard-lookup',
    '/api/dashboard-attention',
  ],
}
