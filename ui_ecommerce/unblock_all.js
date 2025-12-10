const { db } = require('./db');

async function unblockAll() {
    try {
        await db.execute({ sql: "UPDATE users SET is_blocked = 0, ban_expires = NULL WHERE role != 'admin'" });
        console.log("Unblocked all non-admin users.");
    } catch (err) {
        console.error(err);
    }
}

unblockAll();
