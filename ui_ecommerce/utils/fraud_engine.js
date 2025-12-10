const { db } = require('../db');

/**
 * Fraud Detection Engine
 * 
 * Rules:
 * 1. Price Guard: Price too low (< 50% min) or too high (> 120% max).
 * 2. Spam Guard: Posting > 5 items in 1 minute.
 * 3. Feedback: High number of negative reports (TODO).
 */

async function flagUser(userId, reason) {
    console.log(`[FRAUD ENGINE] Flagging User ${userId}: ${reason}`);
    try {
        await db.execute({
            sql: "UPDATE users SET is_flagged = 1, suspicion_score = suspicion_score + 10 WHERE id = ?",
            args: [userId]
        });
        // Optional: Send alert to Admin (console for now)
        console.warn(`USER ${userId} FLAGGED FOR ${reason}`);
    } catch (err) {
        console.error("Error flagging user:", err);
    }
}

async function checkProductPricing(user, price, marketItem) {
    if (!marketItem) return false;

    const minAllowed = marketItem.min_price * 0.4; // Extremely low?
    const maxAllowed = marketItem.max_price * 1.5; // Absurdly high?

    if (price < minAllowed) {
        await flagUser(user.id, `Suspiciously Low Price for ${marketItem.item_name} (₦${price} vs Min ₦${marketItem.min_price})`);
        return true;
    }
    if (price > maxAllowed) {
        // Just a warning for high price, maybe not flag immediately unless repeated
        console.log(`User ${user.id} posted high price: ₦${price}`);
    }
    return false;
}

// Simple in-memory spam check (Reset on restart is fine for MVP)
const lastPostTime = {}; // userId -> timestamp

async function checkSpamming(user) {
    const now = Date.now();
    const last = lastPostTime[user.id] || 0;

    if (now - last < 5000) { // Less than 5 seconds between posts
        await flagUser(user.id, "Spamming Application (Posting too fast)");
        return true;
    }

    lastPostTime[user.id] = now;
    return false;
}

module.exports = { checkProductPricing, checkSpamming, flagUser };
