const { db, initDb } = require('./db');
require('dotenv').config();

async function updateAdminEmail() {
    try {
        await initDb();
        const email = 'Bomane.ar@gmail.com';
        console.log(`Updating Admin email to: ${email}`);

        // Update where username is 'admin' 
        const res = await db.execute({
            sql: "UPDATE users SET email = ? WHERE username = 'admin'",
            args: [email]
        });

        const verify = await db.execute({
            sql: "SELECT id, username, email FROM users WHERE username = 'admin'"
        });

        console.log("Admin User Updated:", verify.rows[0]);

    } catch (err) {
        console.error("Error updating admin email:", err);
    }
}

updateAdminEmail();
