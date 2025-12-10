const { db } = require('./db');
const bcrypt = require('bcrypt');

async function inspect() {
    try {
        const { rows } = await db.execute({ sql: "SELECT id, username, role, is_blocked, password FROM users" });
        console.log("Users in DB:");
        for (const u of rows) {
            console.log(`ID: ${u.id}, User: ${u.username}, Role: ${u.role}, Blocked: ${u.is_blocked} (Type: ${typeof u.is_blocked})`);

            if (u.username === 'admin') {
                const match = await bcrypt.compare('admin123', u.password);
                console.log(`Admin Password 'admin123' validates: ${match}`);
            }
            if (u.username === 'debug_user_1') {
                const match = await bcrypt.compare('password123', u.password);
                console.log(`Debug User Password 'password123' validates: ${match}`);
            }
        }
    } catch (err) {
        console.error(err);
    }
}

inspect();
