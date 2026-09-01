'use strict';

const argon2 = require('argon2');
const env = require('../config/env');

const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: env.ARGON2_MEMORY_COST,
  timeCost: env.ARGON2_TIME_COST,
  parallelism: env.ARGON2_PARALLELISM,
};

async function hashPassword(plainPassword) {
  return argon2.hash(plainPassword, HASH_OPTIONS);
}

async function verifyPassword(hash, plainPassword) {
  try {
    return await argon2.verify(hash, plainPassword);
  } catch (err) {
    // argon2.verify throws on malformed hash rather than returning false
    return false;
  }
}

module.exports = { hashPassword, verifyPassword };
