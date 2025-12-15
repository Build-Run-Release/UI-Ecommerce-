const { db } = require('../db');

/**
 * Fraud Detection Engine (Autonomous AI Version)
 * 
 * Logic:
 * 1. Anomaly Detection (Price Guard): Uses Z-score / Standard Deviation Logic.
 * 2. Auto-Ban: Immediately bans users for high-confidence flag violations.
 * 3. Pattern Matching: Finds best category match for dynamic price comparison.
 */

const BLACKLIST_KEYWORDS = [
    "western union", "moneygram", "crypto payment", "whatsapp only",
    "dm for price", "logistics fee", "delivery fee only", "pay before delivery",
    "customs fee", "bitcoin"
];

// --- HELPER: BAN USER ---
async function banUser(userId, days, reason) {
    console.log(`[FRAUD] AUTO-BANNING User ${userId} for ${days} days. Reason: ${reason}`);
    const expires = Date.now() + (days * 24 * 60 * 60 * 1000);

    try {
        await db.execute({
            sql: `UPDATE users SET 
                  is_banned = 1, 
                  ban_expires = ?, 
                  ban_reason = ?,
                  is_blocked = 1 -- legacy support
                  WHERE id = ?`,
            args: [expires, reason, userId]
        });
    } catch (err) {
        console.error("Error banning user:", err);
    }
}

async function flagUser(userId, reason) {
    console.log(`[FRAUD ENGINE] Flagging User ${userId}: ${reason}`);
    try {
        await db.execute({
            sql: "UPDATE users SET is_flagged = 1, suspicion_score = suspicion_score + 20 WHERE id = ?",
            args: [userId]
        });
    } catch (err) {
        console.error("Error flagging user:", err);
    }
}

// --- RULE 1: AUTONOMOUS PRICE GUARD (STATISTICAL) ---
async function detectPriceAnomaly(user, submittedPrice, title) {
    try {
        // 1. Find Best Match in Marker Prices
        const { rows: marketPrices } = await db.execute({ sql: "SELECT * FROM market_prices" });

        // "Smart Match": Find the market item with the longest matching substring in the title
        // e.g. "iPhone 12 Pro" should match "iPhone 12" (len 9) better than "iPhone" (len 6)
        let bestMatch = null;
        let maxLen = 0;

        const lowerTitle = title.toLowerCase();

        for (const item of marketPrices) {
            const itemName = item.item_name.toLowerCase();
            if (lowerTitle.includes(itemName)) {
                if (itemName.length > maxLen) {
                    maxLen = itemName.length;
                    bestMatch = item;
                }
            }
        }

        if (!bestMatch) return null; // No reference found, can't judge.

        // 2. Fetch "Real World" Data for this item to learn context
        // Get prices of existing approved products in this category (or matching title)
        // Heuristic: Select items with same category or fuzzy title match
        const { rows: history } = await db.execute({
            sql: "SELECT price FROM products WHERE title ILIKE ? AND price > 0 LIMIT 50",
            args: [`%${bestMatch.item_name}%`]
        });

        // 3. Statistical Analysis
        let mean = parseFloat(bestMatch.average_price);
        let validPrices = history.map(h => parseFloat(h.price));

        // Add current known market references to the "brain"
        validPrices.push(parseFloat(bestMatch.average_price));
        validPrices.push(parseFloat(bestMatch.min_price));
        validPrices.push(parseFloat(bestMatch.max_price));

        // Calculate Mean
        const sum = validPrices.reduce((a, b) => a + b, 0);
        mean = sum / validPrices.length;

        // Calculate Standard Deviation (Sigma)
        const variance = validPrices.reduce((total, val) => total + Math.pow(val - mean, 2), 0) / validPrices.length;
        const sigma = Math.sqrt(variance);

        // 4. Define Dynamic Bounds (Autonomous)
        // 3 Sigma covers 99.7% of valid data. Anything outside is an anomaly.
        // Tweak: 2 Sigma is stricter (95%). Let's use 2.5 for ecommerce noise.

        // Safety Fallback: Use explicit min/max from seed if sigma is suspiciously low (not enough data)
        let minAllowed, maxAllowed;

        if (validPrices.length < 5 || sigma < (mean * 0.1)) {
            // Not enough "AI Learning" yet, fallback to seed
            minAllowed = bestMatch.min_price * 0.5; // 50% margin
            maxAllowed = bestMatch.max_price * 2.0; // 200% margin
        } else {
            // autonomous Mode
            minAllowed = mean - (2.5 * sigma);
            maxAllowed = mean + (2.5 * sigma);
        }

        // Hard floor
        if (minAllowed < 100) minAllowed = 100;

        console.log(`[AI PRICE GUARD] Item: ${bestMatch.item_name} | Submit: ${submittedPrice} | Mean: ${mean.toFixed(0)} | σ: ${sigma.toFixed(0)} | Range: [${minAllowed.toFixed(0)} - ${maxAllowed.toFixed(0)}]`);

        // 5. Decision
        if (submittedPrice < minAllowed) {
            const reason = `Price Anomaly (Too Low): ₦${submittedPrice} is absurdly low for ${bestMatch.item_name} (AI Expected > ₦${minAllowed.toFixed(0)})`;
            // Auto-Ban for 1 Week
            await banUser(user.id, 7, reason);
            return { isFraud: true, reason };
        }

        if (submittedPrice > maxAllowed) {
            const reason = `Price Anomaly (Too High): ₦${submittedPrice} is absurdly high for ${bestMatch.item_name} (AI Expected < ₦${maxAllowed.toFixed(0)})`;
            // Auto-Ban for 1 Week
            await banUser(user.id, 7, reason);
            return { isFraud: true, reason };
        }

        return { isFraud: false };

    } catch (err) {
        console.error("Price Anomaly Error:", err);
        return { isFraud: false }; // Fail open to avoid blocking legitimate users on error
    }
}

// --- RULE 2: SPAM (In-Memory) ---
const lastPostTime = {};
async function checkSpamming(user) {
    const now = Date.now();
    const last = lastPostTime[user.id] || 0;
    if (now - last < 5000) {
        await flagUser(user.id, "Spamming Application (Posting too fast)");
        // Aggressive: If spamming > 3 times, ban? Keep simple for now.
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
            const reason = `Used Restricted Keyword: "${word}"`;
            await flagUser(user.id, reason);
            // Keywords are often scams. Ban?
            // Let's safe ban for 3 days.
            await banUser(user.id, 3, reason);
            return true;
        }
    }
    return false;
}

// --- RULE 4: BANK COLLISION ---
async function checkBankDetails(user, accountNumber) {
    try {
        const result = await db.execute({
            sql: "SELECT id, username FROM users WHERE account_number = ? AND id != ?",
            args: [accountNumber, user.id]
        });

        if (result.rows.length > 0) {
            const otherUser = result.rows[0];
            await flagUser(user.id, `Bank Account Collision with User ${otherUser.username}`);
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
        if (!user.created_at) return false;
        const created = new Date(user.created_at).getTime();
        const now = Date.now();
        const hoursOld = (now - created) / (1000 * 60 * 60);

        if (hoursOld < 24) {
            const prodCount = await db.execute({
                sql: "SELECT COUNT(*) as count FROM products WHERE seller_id = ?",
                args: [user.id]
            });

            const count = parseInt(prodCount.rows[0].count);
            if (count >= 5) { // Increased limit slightly
                await flagUser(user.id, `New Account Velocity Limit (Max 5 items in 24h)`);
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
    detectPriceAnomaly,
    checkSpamming,
    checkDescriptionContent,
    checkBankDetails,
    checkAccountVelocity,
    flagUser,
    banUser
};
