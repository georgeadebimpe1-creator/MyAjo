import { NextResponse } from 'next/server'

export async function POST(request) {
  const { password } = await request.json()

  if (password !== process.env.DASHBOARD_PASSWORD) {
    return new NextResponse('Incorrect password', { status: 401 })
  }

  const response = new NextResponse('OK', { status: 200 })
  // httpOnly means this cookie can't be read or stolen via JavaScript in the
  // browser — a meaningful step up in safety over a plain client-side check.
  response.cookies.set('myajo_dashboard_auth', password, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: 60 * 60 * 24 * 7, // stays logged in for 7 days
    path: '/',
  })
  return response
}
