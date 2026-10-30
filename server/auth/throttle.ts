import { createHmac } from 'node:crypto'
import type { PrismaClient } from '../../src/generated/prisma/client.ts'
import { AuthFailure } from './errors.ts'

export function throttleKey(secret: string, namespace: 'email' | 'ip' | 'auth-ip', value: string) {
  return `${namespace}:${createHmac('sha256', secret).update(value).digest('hex')}`
}

type Window = { count: number; retry: number }
export async function reserve(db: PrismaClient, key: string, max: number, seconds: number) {
  const rows = await db.$queryRaw<Window[]>`
    INSERT INTO "LoginThrottle" (key,count,"windowStartedAt","expiresAt","updatedAt")
    VALUES (${key},1,clock_timestamp(),clock_timestamp()+${seconds}*interval '1 second',clock_timestamp())
    ON CONFLICT (key) DO UPDATE SET
      count=CASE WHEN "LoginThrottle"."expiresAt"<=clock_timestamp() THEN 1 ELSE "LoginThrottle".count+1 END,
      "windowStartedAt"=CASE WHEN "LoginThrottle"."expiresAt"<=clock_timestamp() THEN clock_timestamp() ELSE "LoginThrottle"."windowStartedAt" END,
      "expiresAt"=CASE WHEN "LoginThrottle"."expiresAt"<=clock_timestamp() THEN clock_timestamp()+${seconds}*interval '1 second' ELSE "LoginThrottle"."expiresAt" END,
      "updatedAt"=clock_timestamp()
    RETURNING count,GREATEST(1,ceil(extract(epoch FROM "expiresAt"-clock_timestamp())))::integer AS retry
  `
  if (rows[0].count > max) throw new AuthFailure('RATE_LIMITED', 429, rows[0].retry)
}

export async function checkEmail(db: PrismaClient, key: string) {
  const rows = await db.$queryRaw<Window[]>`
    SELECT count,GREATEST(1,ceil(extract(epoch FROM "expiresAt"-clock_timestamp())))::integer AS retry
    FROM "LoginThrottle" WHERE key=${key} AND "expiresAt">clock_timestamp()
  `
  if (rows[0]?.count >= 5) throw new AuthFailure('RATE_LIMITED', 429, rows[0].retry)
}

export async function recordFailure(db: PrismaClient, key: string) {
  // Completed failures count atomically, including requests already in flight.
  await reserve(db, key, Number.MAX_SAFE_INTEGER, 900)
}
