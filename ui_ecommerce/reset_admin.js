const { db } = require('./db');
const bcrypt = require('bcrypt');

async function resetAdmin() {
    try {
        const hash = await bcrypt.hash('admin123', 10);
        await db.execute({
            sql: "UPDATE users SET password = ? WHERE username = 'admin'",
            args: [hash]
        });
        console.log("Admin password reset to 'admin123'");
    } catch (err) {
        console.error(err);
    }
}

resetAdmin();
