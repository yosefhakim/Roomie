'use strict';

const { query } = require('../db/pool');

async function logAdminAction({ adminUserId, action, targetUserId = null, metadata = {} }) {
  await query(
    `INSERT INTO admin_audit_log (admin_user_id, action, target_user_id, metadata)
     VALUES ($1, $2, $3, $4)`,
    [adminUserId, action, targetUserId, JSON.stringify(metadata)]
  );
}

async function getAuditLog({ limit = 100, offset = 0 } = {}) {
  const { rows } = await query(
    `SELECT
       al.id, al.action, al.metadata, al.created_at,
       admin.username AS admin_username, admin.id AS admin_user_id,
       target.username AS target_username, target.id AS target_user_id
     FROM admin_audit_log al
     JOIN users admin ON admin.id = al.admin_user_id
     LEFT JOIN users target ON target.id = al.target_user_id
     ORDER BY al.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
}

async function getDailyActiveUsers(days = 30) {
  const { rows } = await query(
    `SELECT activity_date, COUNT(DISTINCT user_id)::int AS active_users
     FROM user_activity_days
     WHERE activity_date >= CURRENT_DATE - $1::int
     GROUP BY activity_date
     ORDER BY activity_date ASC`,
    [days]
  );
  return rows;
}

async function getMonthlyActiveUsers() {
  const { rows } = await query(
    `SELECT COUNT(DISTINCT user_id)::int AS mau
     FROM user_activity_days
     WHERE activity_date >= CURRENT_DATE - INTERVAL '30 days'`
  );
  return rows[0]?.mau || 0;
}

async function getTodayActiveUsers() {
  const { rows } = await query(
    `SELECT COUNT(DISTINCT user_id)::int AS dau
     FROM user_activity_days
     WHERE activity_date = CURRENT_DATE`
  );
  return rows[0]?.dau || 0;
}

async function getNewUserSignups(days = 30) {
  const { rows } = await query(
    `SELECT DATE(created_at) AS signup_date, COUNT(*)::int AS count
     FROM users
     WHERE created_at >= CURRENT_DATE - $1::int
     GROUP BY DATE(created_at)
     ORDER BY signup_date ASC`,
    [days]
  );
  return rows;
}

async function getUserCounts() {
  const { rows } = await query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE is_banned)::int AS banned,
       COUNT(*) FILTER (WHERE is_admin)::int AS admins,
       COUNT(*) FILTER (WHERE created_at >= now() - INTERVAL '7 days')::int AS new_this_week
     FROM users`
  );
  return rows[0];
}

module.exports = {
  logAdminAction,
  getAuditLog,
  getDailyActiveUsers,
  getMonthlyActiveUsers,
  getTodayActiveUsers,
  getNewUserSignups,
  getUserCounts,
};
