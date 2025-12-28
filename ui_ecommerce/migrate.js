const { initDb, pool } = require('./db');

async function runMigration() {
    console.log("Starting Manual Verification/Migration...");
    await initDb();
    console.log("Migration finished.");
    // We can also run raw queries here if we need to backfill data or modify existing columns that initDb's "IF NOT EXISTS" won't catch.
    // However, for this task, the new columns were added via ALTER TABLE commands in a "Lazy" way or I should add them now explicitly if initDb only does CREATE TABLE IF NOT EXISTS.

    // Wait... looking at my previous db.js edit, I added them to the CREATE TABLE statements. 
    // BUT if the tables already exist, those CREATE statements won't run.
    // I need to add explicit ALTER TABLE statements for existing tables in encryption.

    try {
        const client = await pool.connect();
        try {
            console.log("Applying ALTER TABLE updates...");

            // Users
            await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS university_id TEXT`);
            await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS dorm TEXT`);
            await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified_student INTEGER DEFAULT 0`);
            await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_doc_url TEXT`);
            await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_otp_sent_at BIGINT`);
            await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number TEXT UNIQUE`);

            // Products
            await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS condition TEXT`);
            await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS campus_zone TEXT`);
            await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS isbn TEXT`);

            console.log("ALTER TABLE updates applied.");
        } finally {
            client.release();
        }
    } catch (err) {
        console.error("Migration Error:", err);
    }

    process.exit(0);
}

runMigration();
