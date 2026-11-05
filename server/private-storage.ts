import type { RequestHandler } from 'express'

// Run before document navigation and Vite's /@fs and raw asset handlers.
export const privateStorage: RequestHandler = (request, response, next) => {
  let path = request.path
  try { for (let count = 0; count < 3; count++) path = decodeURIComponent(path) } catch { return response.status(400).json({ error: 'Invalid input' }) }
  if (path.replaceAll('\\', '/').split('/').some((part) => part.toLowerCase() === '.local')) return response.status(404).json({ error: 'Not found' })
  next()
}
