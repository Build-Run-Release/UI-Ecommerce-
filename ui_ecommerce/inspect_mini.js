const { db } = require('./db');

async function inspect() {
    try {
        const { rows } = await db.execute({ sql: "SELECT username, is_blocked FROM users" });
        rows.forEach(u => {
            console.log(`${u.username}: ${u.is_blocked} (${typeof u.is_blocked})`);
        });
    } catch (err) { console.error(err); }
}
inspect();
