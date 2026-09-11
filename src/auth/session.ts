import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { Context } from 'hono'
import { sign, verifySigned } from './crypto'

const COOKIE = 'threads_operator_session'
const TTL_SECONDS = 8 * 60 * 60

function secure(c: Context): boolean { return new URL(c.req.url).protocol === 'https:' }

export async function createSession(c: Context, secret: string): Promise<void> {
  const expires = Math.floor(Date.now() / 1000) + TTL_SECONDS
  setCookie(c, COOKIE, await sign(`operator:${expires}`, secret), {
    httpOnly: true, secure: secure(c), sameSite: 'Lax', path: '/', maxAge: TTL_SECONDS,
  })
}

export async function hasSession(c: Context, secret: string): Promise<boolean> {
  const cookie = getCookie(c, COOKIE)
  if (!cookie) return false
  const value = await verifySigned(cookie, secret)
  if (!value) return false
  const [role, expires] = value.split(':')
  return role === 'operator' && Number(expires) > Math.floor(Date.now() / 1000)
}

export function clearSession(c: Context): void {
  deleteCookie(c, COOKIE, { path: '/', secure: secure(c), sameSite: 'Lax' })
}
