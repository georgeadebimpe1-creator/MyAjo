import { NextResponse } from 'next/server'

// Protects /dashboard — without this, anyone with the URL can see every
// trader's real name, phone number, savings amount, and MyAjo's commission
// earned. This checks for a valid login cookie before allowing access.
export function middleware(request) {
  const authCookie = request.cookies.get('myajo_dashboard_auth')

  if (authCookie?.value === process.env.DASHBOARD_PASSWORD) {
    return NextResponse.next()
  }

  const loginUrl = new URL('/dashboard-login', request.url)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: '/dashboard',
}
