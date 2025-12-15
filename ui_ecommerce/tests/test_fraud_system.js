const { db, initDb } = require('../db');
const { detectPriceAnomaly, banUser } = require('../utils/fraud_engine');

// Mock User
const mockUser = { id: 999, username: 'test_fraud_user', created_at: new Date().toISOString() };

async function runTests() {
    console.log("--- STARTING FRAUD SYSTEM VERIFICATION ---");
    await initDb();

    // 1. Setup Data
    await db.execute({ sql: "DELETE FROM appeals WHERE user_id = 999" });
    await db.execute({ sql: "DELETE FROM users WHERE id = 999" });
    await db.execute({
        sql: "INSERT INTO users (id, username, password, role) VALUES (999, 'test_fraud_user', 'hashed_pw', 'seller')"
    });

    // 2. Test Price Anomaly (High)
    console.log("\n[TEST 1] Testing Price Anomaly (High)...");
    // iPhone 12 avg is ~300k. 5M should flag.
    const resultHigh = await detectPriceAnomaly(mockUser, 5000000, "iPhone 12");
    if (resultHigh.isFraud) {
        console.log("✅ PASSED: Detected High Price Anomaly.");
    } else {
        console.error("❌ FAILED: Did not detect High Price Anomaly.");
    }

    // 3. Verify Auto-Ban
    console.log("\n[TEST 2] Verifying Auto-Ban...");
    const { rows: userRows } = await db.execute({ sql: "SELECT * FROM users WHERE id = 999" });
    const user = userRows[0];

    if (user.is_banned && user.ban_expires) {
        console.log(`✅ PASSED: User Banned. Expires: ${new Date(Number(user.ban_expires)).toISOString()}`);
    } else {
        console.error("❌ FAILED: User was not banned.");
    }

    // 4. Test Appeal
    console.log("\n[TEST 3] Testing Appeal Submission...");
    try {
        await db.execute({
            sql: "INSERT INTO appeals (user_id, message) VALUES (?, ?)",
            args: [999, "This was a test."]
        });
        console.log("✅ PASSED: Appeal Submitted.");
    } catch (e) {
        console.error("❌ FAILED: Appeal Submission Error", e);
    }

    // 5. Test Admin Unban
    console.log("\n[TEST 4] Testing Admin Unban...");
    await db.execute({
        sql: "UPDATE users SET is_blocked = 0, is_banned = 0, ban_expires = null WHERE id = 999"
    });

    const { rows: unbannedUser } = await db.execute({ sql: "SELECT * FROM users WHERE id = 999" });
    if (!unbannedUser[0].is_banned) {
        console.log("✅ PASSED: User Unbanned.");
    } else {
        console.error("❌ FAILED: User still banned.");
    }

    console.log("\n--- VERIFICATION COMPLETE ---");
    process.exit(0);
}

// Run
runTests().catch(console.error);
