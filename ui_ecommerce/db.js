const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');

const dataDir = path.resolve(__dirname, 'data');
if (!fs.existsSync(dataDir)){
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.resolve(dataDir, 'ecommerce.db');
const db = new sqlite3.Database(dbPath);

function initDb() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT,
            role TEXT,
            balance REAL DEFAULT 0,
            wallet_balance REAL DEFAULT 0,
            is_blocked INTEGER DEFAULT 0,
            bank_name TEXT,
            account_number TEXT,
            paystack_subaccount_code TEXT
        )`, (err) => {
            if (err) console.error("Error creating users table:", err);
            else console.log("Users table ready");
        });

        db.run(`CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            description TEXT,
            price REAL,
            seller_id INTEGER,
            image_url TEXT,
            FOREIGN KEY(seller_id) REFERENCES users(id)
        )`, (err) => {
            if (err) console.error("Error creating products table:", err);
            else console.log("Products table ready");
        });

        db.run(`CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            buyer_id INTEGER,
            product_id INTEGER,
            amount REAL,
            service_fee REAL,
            seller_amount REAL,
            status TEXT,
            buyer_confirmed INTEGER DEFAULT 0,
            seller_confirmed INTEGER DEFAULT 0,
            escrow_released INTEGER DEFAULT 0,
            payment_reference TEXT,
            FOREIGN KEY(buyer_id) REFERENCES users(id),
            FOREIGN KEY(product_id) REFERENCES products(id)
        )`, (err) => {
            if (err) console.error("Error creating orders table:", err);
            else console.log("Orders table ready");
        });

        db.run(`CREATE TABLE IF NOT EXISTS ads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            seller_id INTEGER,
            message TEXT,
            amount REAL,
            category TEXT,
            expiry_date INTEGER,
            status TEXT,
            payment_reference TEXT,
            FOREIGN KEY(seller_id) REFERENCES users(id)
        )`, (err) => {
            if (err) console.error("Error creating ads table:", err);
            else console.log("Ads table ready");
        });

        // Create Default Admin
        const adminPass = 'admin123'
        db.run('INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)', ['admin', adminPass, 'admin']);
    });
}

module.exports = { db, initDb };
