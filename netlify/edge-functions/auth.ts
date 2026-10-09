import type { Config, Context } from '@netlify/edge-functions'

const REALM = 'BP Tracker'

// A doormat, not a lock. The readings live in IndexedDB in the browser, never on
// the server, so this gate decides who may load the app — it protects no data.
// See the Deploying section of the README.
//
// Credentials come from the Netlify environment, not from this file: the repo is
// the one place a site password must never be, because it stays in git history
// after it is rotated.
export default async (request: Request, _context: Context) => {
  const user = Netlify.env.get('BP_USER')
  const password = Netlify.env.get('BP_PASSWORD')

  // Fail closed. A forgotten environment variable must not publish a blood
  // pressure log to the open internet.
  if (!user || !password) return unauthorized()

  const header = request.headers.get('authorization') ?? ''
  if (!header.startsWith('Basic ')) return unauthorized()

  let decoded: string
  try {
    // atob yields one character per byte, i.e. latin1. Decoding those bytes back
    // as UTF-8 is what makes a password with an accent in it comparable to the
    // environment variable it was typed from; `atob(...)` alone mangles it.
    const bytes = Uint8Array.from(atob(header.slice('Basic '.length)), (c) => c.charCodeAt(0))
    decoded = new TextDecoder().decode(bytes)
  } catch {
    return unauthorized() // Not base64. Malformed header, not a credential.
  }

  // Split on the first colon only — a password may legitimately contain one.
  const separator = decoded.indexOf(':')
  if (separator < 0) return unauthorized()

  // Both compared before either is judged. A short-circuiting && would answer a
  // wrong username faster than a wrong password and give the digests away.
  const [userOk, passwordOk] = await Promise.all([
    matches(decoded.slice(0, separator), user),
    matches(decoded.slice(separator + 1), password),
  ])
  const ok = userOk && passwordOk

  // Returning nothing passes the request through to the CDN untouched.
  return ok ? undefined : unauthorized()
}

function unauthorized() {
  return new Response('Authentication required.\n', {
    status: 401,
    headers: {
      'www-authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
      // A gate that 401s is already unindexable, but the header costs nothing
      // and covers the window before the environment variables are set.
      'x-robots-tag': 'noindex, nofollow',
    },
  })
}

// Compared as digests so the loop always runs over 32 equal-length bytes and a
// near-miss cannot be narrowed by timing. Overkill for one person, but the
// alternative is a === that leaks the common prefix.
async function matches(given: string, expected: string) {
  const [a, b] = await Promise.all([digest(given), digest(expected)])
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

async function digest(value: string) {
  const bytes = new TextEncoder().encode(value)
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
}

export const config: Config = { path: '/*' }
