import { createHmac } from 'node:crypto'
import type { Request } from 'express'
import type { PrismaClient } from '../../src/generated/prisma/client.ts'
import { AuthFailure } from './errors.ts'

/** Completed invalid-password attempts that block further sign-in for the email window. */
export const EMAIL_FAILURE_LIMIT = 5

export function throttleKey(secret: string, namespace: 'email' | 'ip' | 'auth-ip', value: string) {
  return `${namespace}:${createHmac('sha256', secret).update(value).digest('hex')}`
}

export function clientIp(request: Request) {
  // With TRUST_PROXY unset, Express request.ip is the direct socket address.
  // When trust proxy is configured, it is the client address from that boundary.
  return request.ip || request.socket.remoteAddress || 'unknown'
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
  if (rows[0]?.count >= EMAIL_FAILURE_LIMIT) throw new AuthFailure('RATE_LIMITED', 429, rows[0].retry)
}

export async function recordFailure(db: PrismaClient, key: string) {
  // Completed failures count atomically, including requests already in flight.
  // Cap at the email block threshold so sustained attacks cannot inflate the row.
  await db.$queryRaw`
    INSERT INTO "LoginThrottle" (key,count,"windowStartedAt","expiresAt","updatedAt")
    VALUES (${key},1,clock_timestamp(),clock_timestamp()+900*interval '1 second',clock_timestamp())
    ON CONFLICT (key) DO UPDATE SET
      count=CASE WHEN "LoginThrottle"."expiresAt"<=clock_timestamp() THEN 1
        ELSE LEAST("LoginThrottle".count+1, ${EMAIL_FAILURE_LIMIT}) END,
      "windowStartedAt"=CASE WHEN "LoginThrottle"."expiresAt"<=clock_timestamp() THEN clock_timestamp() ELSE "LoginThrottle"."windowStartedAt" END,
      "expiresAt"=CASE WHEN "LoginThrottle"."expiresAt"<=clock_timestamp() THEN clock_timestamp()+900*interval '1 second' ELSE "LoginThrottle"."expiresAt" END,
      "updatedAt"=clock_timestamp()
  `
}
