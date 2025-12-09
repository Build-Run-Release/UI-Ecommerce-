require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

// CockroachDB / PostgreSQL Connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

if (!process.env.DATABASE_URL) {
    console.error("❌ ERROR: DATABASE_URL is missing from .env");
} else {
    // Debug: Print URL to check for formatting issues (mask password)
    const maskedUrl = process.env.DATABASE_URL.replace(/:([^:@]+)@/, ':****@');
    console.log("ℹ️ Connecting to DB at:", maskedUrl);
}

// Adapter to maintain compatibility with existing 'db.execute({ sql, args })' calls
const db = {
    execute: async ({ sql, args }) => {
        try {
            // Convert ? placeholders to $1, $2, etc.
            let paramIndex = 1;
            const text = sql.replace(/\?/g, () => `$${paramIndex++}`);

            const res = await pool.query(text, args);
            return { rows: res.rows };
        } catch (err) {
            console.error("DB Query Error:", err.message);
            throw err;
        }
    }
};

async function initDb() {
    try {
        const client = await pool.connect();
        try {
            console.log("Initializing Database...");

            // 1. Users Table
            await client.query(`CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                role TEXT,
                balance DECIMAL(10,2) DEFAULT 0,
                wallet_balance DECIMAL(10,2) DEFAULT 0,
                is_blocked INTEGER DEFAULT 0,
                bank_name TEXT,
                account_number TEXT,
                paystack_subaccount_code TEXT,
                bank_code TEXT
            )`);

            // 2. Products Table
            await client.query(`CREATE TABLE IF NOT EXISTS products (
                id SERIAL PRIMARY KEY,
                title TEXT,
                description TEXT,
                price DECIMAL(10,2),
                category TEXT,
                seller_id INTEGER REFERENCES users(id),
                image_url TEXT
            )`);

            // 3. Orders Table
            await client.query(`CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                buyer_id INTEGER REFERENCES users(id),
                seller_id INTEGER REFERENCES users(id),
                product_id INTEGER REFERENCES products(id),
                amount DECIMAL(10,2),
                service_fee DECIMAL(10,2),
                seller_amount DECIMAL(10,2),
                status TEXT,
                buyer_confirmed INTEGER DEFAULT 0,
                seller_confirmed INTEGER DEFAULT 0,
                escrow_released INTEGER DEFAULT 0,
                payment_reference TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`);

            // 4. Ads Table
            await client.query(`CREATE TABLE IF NOT EXISTS ads (
                id SERIAL PRIMARY KEY,
                seller_id INTEGER REFERENCES users(id),
                message TEXT,
                amount DECIMAL(10,2),
                category TEXT,
                expiry_date BIGINT,
                status TEXT,
                payment_reference TEXT
            )`);

            // 5. Cart Table
            await client.query(`CREATE TABLE IF NOT EXISTS cart (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                product_id INTEGER REFERENCES products(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`);

            // 6. Wishlist Table
            await client.query(`CREATE TABLE IF NOT EXISTS wishlist (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                product_id INTEGER REFERENCES products(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`);

            // 7. Market Prices (for Price Guard)
            await client.query(`CREATE TABLE IF NOT EXISTS market_prices (
                id SERIAL PRIMARY KEY,
                item_name TEXT,
                average_price DECIMAL(10,2),
                min_price DECIMAL(10,2),
                max_price DECIMAL(10,2)
            )`);

            // Create Default Admin
            const adminPass = 'admin123';
            const hashedAdminPass = await bcrypt.hash(adminPass, 10);

            await client.query(`
                INSERT INTO users (username, password, role) 
                VALUES ($1, $2, $3) 
                ON CONFLICT (username) DO NOTHING
            `, ['admin', hashedAdminPass, 'admin']);

            console.log("Database tables initialized successfully.");

        } finally {
            client.release();
        }

    } catch (err) {
        console.error("Error initializing DB:", err);
    }
}

module.exports = { db, initDb };
