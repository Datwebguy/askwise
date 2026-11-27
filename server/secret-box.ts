// Encrypts small secrets (people's Notion tokens) before they are stored.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export class SecretBox {
  private readonly key: Buffer

  constructor(secret: string) {
    this.key = crypto.createHash('sha256').update(secret).digest()
  }

  seal(plain: string): string {
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv)
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    return [iv, cipher.getAuthTag(), data].map(b => b.toString('base64url')).join('.')
  }

  open(sealed: string): string {
    const [iv, tag, data] = sealed.split('.').map(p => Buffer.from(p, 'base64url'))
    if (!iv || !tag || !data || iv.length !== 12 || tag.length !== 16) throw new Error('Sealed value is not valid')
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv, { authTagLength: 16 })
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  }
}

/** Uses ASKWISE_SECRET, or creates a random key file in the data folder the first time. */
export function loadSecret(configured: string | null, dataDir: string): string {
  if (configured) return configured
  const file = path.join(dataDir, 'secret.key')
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim()
  fs.mkdirSync(dataDir, { recursive: true })
  const key = crypto.randomBytes(32).toString('base64url')
  fs.writeFileSync(file, key, { mode: 0o600 })
  return key
}
