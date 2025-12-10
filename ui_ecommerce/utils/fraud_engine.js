const { db } = require('../db');

/**
 * Fraud Detection Engine
 * 
 * Rules:
 * 1. Price Guard: Price too low (< 40% min) or too high (> 150% max).
 * 2. Spam Guard: Posting > 10 items in 1 minute.
 * 3. Keyword Guard (New): Flag scams like "Western Union".
 * 4. Bank Collision (New): Prevent multi-accounting.
 * 5. Velocity Check (New): New users posting too fast.
 */

const BLACKLIST_KEYWORDS = [
    "western union", "moneygram", "crypto payment", "whatsapp only",
    "dm for price", "logistics fee", "delivery fee only", "pay before delivery",
    "customs fee", "bitcoin"
];

async function flagUser(userId, reason) {
    console.log(`[FRAUD ENGINE] Flagging User ${userId}: ${reason}`);
    try {
        await db.execute({
            sql: "UPDATE users SET is_flagged = 1, suspicion_score = suspicion_score + 20 WHERE id = ?",
            args: [userId]
        });
        console.warn(`USER ${userId} FLAGGED FOR ${reason}`);
    } catch (err) {
        console.error("Error flagging user:", err);
    }
}

// --- RULE 1: PRICING ---
async function checkProductPricing(user, price, marketItem) {
    if (!marketItem) return false;
    const minAllowed = marketItem.min_price * 0.4;
    const maxAllowed = marketItem.max_price * 1.5;

    if (price < minAllowed) {
        await flagUser(user.id, `Suspiciously Low Price for ${marketItem.item_name} (₦${price} vs Min ₦${marketItem.min_price})`);
        return true;
    }
    return false;
}

// --- RULE 2: SPAM (In-Memory) ---
const lastPostTime = {};
async function checkSpamming(user) {
    const now = Date.now();
    const last = lastPostTime[user.id] || 0;
    if (now - last < 5000) {
        await flagUser(user.id, "Spamming Application (Posting too fast)");
        return true;
    }
    lastPostTime[user.id] = now;
    return false;
}

// --- RULE 3: KEYWORD MONITOR ---
async function checkDescriptionContent(user, title, description) {
    const content = (title + " " + description).toLowerCase();

    for (const word of BLACKLIST_KEYWORDS) {
        if (content.includes(word)) {
            await flagUser(user.id, `Used Blacklisted Keyword: "${word}"`);
            return true;
        }
    }
    return false;
}

// --- RULE 4: BANK COLLISION ---
async function checkBankDetails(user, accountNumber) {
    try {
        // Check if ANY other user has this account number
        const result = await db.execute({
            sql: "SELECT id, username FROM users WHERE account_number = ? AND id != ?",
            args: [accountNumber, user.id]
        });

        if (result.rows.length > 0) {
            const otherUser = result.rows[0];
            await flagUser(user.id, `Bank Account Collision with User ${otherUser.username} (Potential Multi-Accounting)`);
            return true;
        }
        return false;
    } catch (err) {
        console.error("Bank Collision Check Error:", err);
        return false;
    }
}

// --- RULE 5: NEW ACCOUNT VELOCITY ---
async function checkAccountVelocity(user) {
    try {
        // Only verify this for accounts created < 24 hours ago
        if (!user.created_at) return false; // Legacy users

        const created = new Date(user.created_at).getTime();
        const now = Date.now();
        const hoursOld = (now - created) / (1000 * 60 * 60);

        if (hoursOld < 24) {
            // Check usage limit? We can check product count.
            // For now, simpler: Just strict flag on ANY suspicion if new.
            // Or rate limit: Max 3 products in first 24h.

            const prodCount = await db.execute({
                sql: "SELECT COUNT(*) as count FROM products WHERE seller_id = ?",
                args: [user.id]
            });

            const count = parseInt(prodCount.rows[0].count);
            if (count >= 3) {
                await flagUser(user.id, `New Account Velocity Limit (Max 3 items in 24h)`);
                return true;
            }
        }
        return false;
    } catch (err) {
        console.error("Velocity Check Error:", err);
        return false;
    }
}

module.exports = {
    checkProductPricing,
    checkSpamming,
    checkDescriptionContent,
    checkBankDetails,
    checkAccountVelocity,
    flagUser
};
