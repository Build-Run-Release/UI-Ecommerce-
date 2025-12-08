require('dotenv').config();
const { createClient } = require('@libsql/client');

const client = createClient({
    url: process.env.TURSO_DATABASE_URL ? process.env.TURSO_DATABASE_URL : 'file:local.db', // Fallback to local file if not set, or error
    authToken: process.env.TURSO_AUTH_TOKEN,
});

async function initDb() {
    try {
        await client.execute(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT,
            role TEXT,
            balance REAL DEFAULT 0,
            wallet_balance REAL DEFAULT 0,
            is_blocked INTEGER DEFAULT 0,
            bank_name TEXT,
            account_number TEXT,
            paystack_subaccount_code TEXT,
            bank_code TEXT
        )`);
        console.log("Users table ready");

        // Migration: Add bank_code if missing
        const userColsRes = await client.execute("PRAGMA table_info(users)");
        const userCols = userColsRes.rows.map(r => r.name);
        if (!userCols.includes('bank_code')) {
            console.log("Migrating: Adding bank_code column to users...");
            await client.execute("ALTER TABLE users ADD COLUMN bank_code TEXT");
        }
        if (!userCols.includes('bank_name')) {
            console.log("Migrating: Adding bank_name column to users...");
            await client.execute("ALTER TABLE users ADD COLUMN bank_name TEXT");
        }
        if (!userCols.includes('account_number')) {
            console.log("Migrating: Adding account_number column to users...");
            await client.execute("ALTER TABLE users ADD COLUMN account_number TEXT");
        }

        await client.execute(`CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            description TEXT,
            price REAL,
            category TEXT,
            seller_id INTEGER,
            image_url TEXT,
            FOREIGN KEY(seller_id) REFERENCES users(id)
        )`);
        console.log("Products table ready");

        // Migration for products category
        // Note: LibSQL execute returns Result { columns, rows, ... }
        // We can check columns by selecting 1 row usually, or using PRAGMA
        // PRAGMA table_info returns rows
        const prodInfo = await client.execute("PRAGMA table_info(products)");
        if (!prodInfo.rows.some(r => r.name === 'category')) {
            console.log("Migrating: Adding category column to products...");
            await client.execute("ALTER TABLE products ADD COLUMN category TEXT");
        }

        await client.execute(`CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            buyer_id INTEGER,
            seller_id INTEGER,
            product_id INTEGER,
            amount REAL,
            service_fee REAL,
            seller_amount REAL,
            status TEXT,
            buyer_confirmed INTEGER DEFAULT 0,
            seller_confirmed INTEGER DEFAULT 0,
            escrow_released INTEGER DEFAULT 0,
            payment_reference TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(buyer_id) REFERENCES users(id),
            FOREIGN KEY(seller_id) REFERENCES users(id),
            FOREIGN KEY(product_id) REFERENCES products(id)
        )`);
        console.log("Orders table ready");

        // Migration for orders
        const ordersInfo = await client.execute("PRAGMA table_info(orders)");
        const orderCols = ordersInfo.rows.map(r => r.name);
        if (!orderCols.includes('seller_id')) {
            console.log("Migrating: Adding seller_id column to orders...");
            await client.execute("ALTER TABLE orders ADD COLUMN seller_id INTEGER");
        }
        if (!orderCols.includes('created_at')) {
            console.log("Migrating: Adding created_at column to orders...");
            await client.execute("ALTER TABLE orders ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP");
        }

        await client.execute(`CREATE TABLE IF NOT EXISTS ads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            seller_id INTEGER,
            message TEXT,
            amount REAL,
            category TEXT,
            expiry_date INTEGER,
            status TEXT,
            payment_reference TEXT,
            FOREIGN KEY(seller_id) REFERENCES users(id)
        )`);
        console.log("Ads table ready");

        await client.execute(`CREATE TABLE IF NOT EXISTS cart (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            product_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(product_id) REFERENCES products(id)
        )`);
        console.log("Cart table ready");

        await client.execute(`CREATE TABLE IF NOT EXISTS wishlist (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            product_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(product_id) REFERENCES products(id)
        )`);
        console.log("Wishlist table ready");

        // Create Default Admin
        const adminPass = 'admin123';
        // LibSQL uses ? or :param for placeholders. '@libsql/client' supports ?
        await client.execute({
            sql: 'INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)',
            args: ['admin', adminPass, 'admin']
        });

    } catch (err) {
        console.error("Error initializing DB:", err);
    }
}

// Export 'db' as client to minimize rename refactoring, but usage must change
module.exports = { db: client, initDb };

