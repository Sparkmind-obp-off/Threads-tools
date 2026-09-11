const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function base64Url(bytes: Uint8Array): string {
  let value = ''
  for (const byte of bytes) value += String.fromCharCode(byte)
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
}

export function randomState(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)))
}

export async function sha256(value: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))))
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function sign(value: string, secret: string): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(value))
  return `${value}.${base64Url(new Uint8Array(signature))}`
}

export async function verifySigned(signed: string, secret: string): Promise<string | null> {
  const index = signed.lastIndexOf('.')
  if (index < 1) return null
  const value = signed.slice(0, index)
  try {
    const signature = fromBase64Url(signed.slice(index + 1))
    const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), signature.buffer as ArrayBuffer, encoder.encode(value))
    return valid ? value : null
  } catch { return null }
}

async function aesKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest('SHA-256', encoder.encode(`threads-tools:token:${secret}`))
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptToken(token: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(secret), encoder.encode(token))
  return `${base64Url(iv)}.${base64Url(new Uint8Array(encrypted))}`
}

export async function decryptToken(value: string, secret: string): Promise<string> {
  const [iv, payload] = value.split('.')
  if (!iv || !payload) throw new Error('Invalid encrypted token')
  const ivBytes = fromBase64Url(iv)
  const payloadBytes = fromBase64Url(payload)
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes.buffer as ArrayBuffer },
    await aesKey(secret),
    payloadBytes.buffer as ArrayBuffer,
  )
  return decoder.decode(decrypted)
}
