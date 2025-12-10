const { db } = require('./db');

async function debugValues() {
    try {
        const { rows } = await db.execute({ sql: "SELECT username, is_blocked, ban_expires FROM users WHERE username = 'testbuyer'" });
        if (rows.length > 0) {
            const u = rows[0];
            console.log("User:", u);
            console.log("is_blocked raw:", u.is_blocked, "Type:", typeof u.is_blocked);
            console.log("Number(is_blocked):", Number(u.is_blocked));
            console.log("Condition (Number != 0):", Number(u.is_blocked) !== 0);

            console.log("ban_expires raw:", u.ban_expires);
            console.log("Date condition:", u.ban_expires && new Date(Number(u.ban_expires)) > new Date());
        } else {
            console.log("testbuyer not found");
        }
    } catch (err) { console.error(err); }
}

debugValues();
