const { db, initDb } = require('./db');
require('dotenv').config();

async function check() {
    await initDb();
    const res = await db.execute({ sql: "SELECT email FROM users WHERE username = 'admin'" });
    console.log("Current Admin Email:", res.rows[0]?.email);
}
check();
