const { db } = require('./db');

const prices = [
    { item: 'Rice (50kg)', min: 55000, max: 75000, avg: 65000 },
    { item: 'Beans (Mudu)', min: 1200, max: 1800, avg: 1500 },
    { item: 'Yam (Large)', min: 2500, max: 4000, avg: 3200 },
    { item: 'Garri (Paint)', min: 2000, max: 3000, avg: 2500 },
    { item: 'Palm Oil (Bottle)', min: 900, max: 1500, avg: 1200 },
    { item: 'Eggs (Crate)', min: 3500, max: 4500, avg: 4000 }
];

async function seed() {
    try {
        console.log("Creating market_prices table...");
        await db.execute({
            sql: `
            CREATE TABLE IF NOT EXISTS market_prices (
                id SERIAL PRIMARY KEY,
                item_name TEXT UNIQUE,
                min_price DECIMAL(10,2),
                max_price DECIMAL(10,2),
                average_price DECIMAL(10,2)
            )
        `}); // Fixed argument signature and SQL syntax

        console.log("Seeding data...");
        for (const p of prices) {
            await db.execute({
                sql: `INSERT INTO market_prices (item_name, min_price, max_price, average_price) 
                      VALUES (?, ?, ?, ?) 
                      ON CONFLICT(item_name) DO UPDATE SET 
                      min_price=excluded.min_price, 
                      max_price=excluded.max_price, 
                      average_price=excluded.average_price`,
                args: [p.item, p.min, p.max, p.avg]
            });
        }
        console.log("Seeding complete!");
    } catch (err) {
        console.error("Seeding failed:", err);
    }
}

seed();
