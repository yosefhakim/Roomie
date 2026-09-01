'use strict';

require('dotenv').config();
const { z } = require('zod');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),

  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((val) => val.split(',').map((s) => s.trim()).filter(Boolean)),

  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_KEY_PREFIX: z.string().default('roomie:'),

  SOCKET_PING_INTERVAL_MS: z.coerce.number().int().positive().default(20000),
  SOCKET_PING_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),

  ROOM_MAX_MEMBERS: z.coerce.number().int().positive().default(16),
  ROOM_INACTIVE_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  PRESENCE_TTL_SECONDS: z.coerce.number().int().positive().default(45),
  RECONNECT_GRACE_SECONDS: z.coerce.number().int().positive().default(30),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),

  LOG_LEVEL: z.string().default('info'),

  // Postgres
  DATABASE_URL: z.string().default('postgres://roomie:roomie@localhost:5432/roomie'),
  PG_POOL_MAX: z.coerce.number().int().positive().default(10),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 chars'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 chars'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900), // 15 min
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(2592000), // 30 days
  JWT_ISSUER: z.string().default('roomie-backend'),

  // OAuth
  GOOGLE_CLIENT_ID: z.string().default(''),
  APPLE_CLIENT_ID: z.string().default(''),
  APPLE_TEAM_ID: z.string().default(''),
  APPLE_KEY_ID: z.string().default(''),
  APPLE_PRIVATE_KEY: z.string().default(''),

  // Password hashing (argon2id tunables)
  ARGON2_MEMORY_COST: z.coerce.number().int().positive().default(19456), // ~19MB
  ARGON2_TIME_COST: z.coerce.number().int().positive().default(2),
  ARGON2_PARALLELISM: z.coerce.number().int().positive().default(1),

  // Stripe
  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),

  // Agora (voice chat)
  AGORA_APP_ID: z.string().default(''),
  AGORA_APP_CERTIFICATE: z.string().default(''),
  AGORA_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast and loud - a misconfigured server should never boot silently.
  console.error('[FATAL] Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

module.exports = parsed.data;
