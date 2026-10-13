// Helpers for the dashboard login.
//
// Why this file exists: the old login stored a cookie whose value was just
// the word "authenticated". Anyone could create that cookie in their own
// browser and walk in without the password. Now the cookie holds a signed
// token: an expiry time plus a signature that can only be produced by
// someone who knows DASHBOARD_PASSWORD. A faked or edited token fails the
// check, and changing the password logs everyone out.
//
// Uses the Web Crypto API, which works both in middleware and in API routes.

const encoder = new TextEncoder()

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function sign(message, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return toHex(signature)
}

// Compares two strings without stopping at the first difference, so timing
// can't be used to guess the value one character at a time.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

// True if the password typed in matches the real one. Both are scrambled
// first so the comparison doesn't reveal anything about the real password.
export async function passwordMatches(provided, actual) {
  if (typeof provided !== 'string' || typeof actual !== 'string' || actual === '') {
    return false
  }
  const a = await sign('password-check', provided)
  const b = await sign('password-check', actual)
  return safeEqual(a, b)
}

export async function createSessionToken(secret, maxAgeSeconds) {
  const expiresAt = Date.now() + maxAgeSeconds * 1000
  const signature = await sign(`dashboard:${expiresAt}`, secret)
  return `${expiresAt}.${signature}`
}

export async function verifySessionToken(token, secret) {
  if (!token || !secret) return false
  const parts = token.split('.')
  if (parts.length !== 2) return false
  const [expiresAt, signature] = parts
  if (!/^\d+$/.test(expiresAt)) return false
  if (Number(expiresAt) < Date.now()) return false
  const expected = await sign(`dashboard:${expiresAt}`, secret)
  return safeEqual(signature, expected)
    }
