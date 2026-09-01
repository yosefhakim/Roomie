'use strict';

const { z } = require('zod');

const userIdSchema = z.string().min(1).max(128);
const displayNameSchema = z.string().trim().min(1).max(40);
const roomIdSchema = z.string().uuid();

const createRoomPayload = z.object({
  name: z.string().trim().min(1).max(60),
  visibility: z.enum(['public', 'private', 'password']).default('public'),
  password: z.string().min(4).max(64).optional(),
  maxMembers: z.number().int().positive().max(64).optional(),
});

const joinRoomPayload = z.object({
  roomId: roomIdSchema,
  password: z.string().max(64).optional(),
});

const roomIdOnlyPayload = z.object({
  roomId: roomIdSchema,
});

const memberActionPayload = z.object({
  roomId: roomIdSchema,
  targetUserId: userIdSchema,
});

const roleChangePayload = memberActionPayload.extend({
  newRole: z.enum(['owner', 'admin', 'speaker', 'listener']),
});

const mutePayload = memberActionPayload.extend({
  muted: z.boolean(),
});

const handRaisePayload = z.object({
  roomId: roomIdSchema,
  raised: z.boolean(),
});

function validate(schema, payload) {
  const result = schema.safeParse(payload);
  if (!result.success) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.details = result.error.flatten();
    throw err;
  }
  return result.data;
}

const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(24)
  .regex(/^[a-zA-Z0-9_]+$/, 'Username may only contain letters, numbers, and underscores');

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a number');

const registerPayload = z.object({
  email: z.string().trim().toLowerCase().email(),
  username: usernameSchema,
  password: passwordSchema,
  displayName: displayNameSchema.optional(),
});

const loginPayload = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
});

const googleLoginPayload = z.object({
  idToken: z.string().min(1),
});

const appleLoginPayload = z.object({
  identityToken: z.string().min(1),
  fullName: z.string().trim().max(80).optional(),
});

const refreshPayload = z.object({
  refreshToken: z.string().min(1),
});

module.exports = {
  validate,
  usernameSchema,
  passwordSchema,
  registerPayload,
  loginPayload,
  googleLoginPayload,
  appleLoginPayload,
  refreshPayload,
  createRoomPayload,
  joinRoomPayload,
  roomIdOnlyPayload,
  memberActionPayload,
  roleChangePayload,
  mutePayload,
  handRaisePayload,
};
