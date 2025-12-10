const { db, pool } = require('./db');

async function migrate() {
    try {
        console.log("Adding ban_expires column to users table...");
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_expires BIGINT`);
        console.log("Migration successful!");
    } catch (err) {
        console.error("Migration failed:", err);
    } finally {
        pool.end();
    }
}

migrate();
