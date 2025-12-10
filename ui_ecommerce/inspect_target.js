const { db } = require('./db');

async function inspectTestBuyer() {
    try {
        const { rows } = await db.execute({ sql: "SELECT username, is_blocked, ban_expires FROM users WHERE username = 'testbuyer'" });
        if (rows.length > 0) {
            console.log("Found testbuyer:", rows[0]);
            console.log("Types:", {
                is_blocked: typeof rows[0].is_blocked,
                ban_expires: typeof rows[0].ban_expires
            });
        } else {
            console.log("testbuyer not found");
            const all = await db.execute({ sql: "SELECT username, is_blocked, ban_expires FROM users" });
            console.log("All users:", all.rows);
        }
    } catch (err) {
        console.error(err);
    }
}

inspectTestBuyer();
