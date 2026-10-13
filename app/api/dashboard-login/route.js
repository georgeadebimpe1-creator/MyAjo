import { NextResponse } from 'next/server'
import { passwordMatches, createSessionToken } from '../../lib/dashboardAuth'

const SESSION_SECONDS = 60 * 60 * 24 * 7 // stays logged in for 7 days

export async function POST(request) {
  const secret = process.env.DASHBOARD_PASSWORD

  // If the password was never set in Vercel, refuse to log anyone in rather
  // than accidentally accepting an empty password.
  if (!secret) {
    return new NextResponse('Dashboard password is not configured', { status: 500 })
  }

  let password
  try {
    const body = await request.json()
    password = body?.password
  } catch {
    return new NextResponse('Bad request', { status: 400 })
  }

  if (!(await passwordMatches(password, secret))) {
    return new NextResponse('Incorrect password', { status: 401 })
  }

  const token = await createSessionToken(secret, SESSION_SECONDS)

  const response = new NextResponse('OK', { status: 200 })
  response.cookies.set('myajo_dashboard_auth', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: SESSION_SECONDS,
    path: '/',
  })
  return response
}
