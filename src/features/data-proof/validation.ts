// Shared text rules only. No server configuration or fixture identities belong here.
export const proofTextLimit = 500

export function normalizeProofText(value: unknown): string | null {
  if (typeof value !== 'string' || value.includes('\0')) return null
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return null
    } else if (code >= 0xdc00 && code <= 0xdfff) return null
  }
  const normalized = value.trim()
  const count = Array.from(normalized).length
  return count >= 1 && count <= proofTextLimit ? normalized : null
}

export function normalizeSubmissionId(value: unknown): string | null {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : null
}
