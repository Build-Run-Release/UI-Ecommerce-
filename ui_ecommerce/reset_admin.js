const { db, pool } = require('./db');
const bcrypt = require('bcrypt');

async function resetAdmin() {
    try {
        const password = 'admin123';
        const hashedPassword = await bcrypt.hash(password, 10);

        console.log("Resetting admin password...");

        // 1. Try to update existing admin
        const update = await db.execute({
            sql: "UPDATE users SET password = ? WHERE username = 'admin'",
            args: [hashedPassword]
        });

        // 2. If no admin existed, create one
        await db.execute({
            sql: "INSERT INTO users (username, password, role, email) VALUES (?, ?, 'admin', 'admin@campus.market') ON CONFLICT (username) DO NOTHING",
            args: ['admin', hashedPassword]
        });

        console.log("Admin password reset to: " + password);
        process.exit(0);
    } catch (err) {
        console.error("Error resetting admin:", err);
        process.exit(1);
    }
}

resetAdmin();
