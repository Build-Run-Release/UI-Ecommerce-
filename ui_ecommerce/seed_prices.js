const { db } = require('./db');
require('dotenv').config();

const marketCheck = [
    // Electronics (Ibadan Computer Village Estimates - Dec 2024)
    { item_name: "iPhone XR (UK Used)", average_price: 175000, min: 160000, max: 200000 },
    { item_name: "iPhone 11 (UK Used)", average_price: 300000, min: 280000, max: 350000 },
    { item_name: "iPhone 12 (Used)", average_price: 450000, min: 400000, max: 550000 },
    { item_name: "HP Laptop (Core i5, Used)", average_price: 160000, min: 140000, max: 200000 },

    // Foodstuff (Bodija Market Estimates - Dec 2024)
    // "Paint Bucket" is roughly 4kg. Bag of rice is ~50kg.
    // 50kg Rice = ~90k -> 4kg Bucket = ~7.2k
    { item_name: "Garri (Paint Bucket)", average_price: 4500, min: 3500, max: 5500 },
    { item_name: "Rice (Paint Bucket)", average_price: 7500, min: 6500, max: 9000 },
    { item_name: "Beans (Paint Bucket)", average_price: 10000, min: 8500, max: 12000 },
    { item_name: "Vegetable Oil (Bottle)", average_price: 2400, min: 2200, max: 2800 },
    { item_name: "Palm Oil (Bottle)", average_price: 1700, min: 1500, max: 2000 },

    // Electronics
    { item_name: 'iPhone 12', average_price: 300000, min: 250000, max: 350000 },
    { item_name: 'iPhone 11', average_price: 200000, min: 180000, max: 230000 },
    { item_name: 'Samsung S10', average_price: 120000, min: 100000, max: 140000 },
    { item_name: 'HP Elitebook', average_price: 150000, min: 130000, max: 180000 },
    { item_name: 'MacBook Pro 2015', average_price: 250000, min: 220000, max: 280000 },
    { item_name: 'Airpods Pro', average_price: 50000, min: 30000, max: 80000 },
    { item_name: 'Power Bank 20000mAh', average_price: 15000, min: 10000, max: 20000 },

    // Food & Provisions
    { item_name: 'Indomie Carton', average_price: 8500, min: 8000, max: 9500 },
    { item_name: 'Spaghetti Pack', average_price: 800, min: 700, max: 1000 },
    { item_name: 'Egg Crate', average_price: 3500, min: 3200, max: 4000 },
    { item_name: 'Rice (Paint bucket)', average_price: 6000, min: 5500, max: 7000 },
    { item_name: 'Vegetable Oil (Bottle)', average_price: 1200, min: 1000, max: 1500 },

    // Hostel Essentials
    { item_name: 'Mat', average_price: 3000, min: 2500, max: 4000 },
    { item_name: 'Bucket', average_price: 1500, min: 1200, max: 2000 },
    { item_name: 'Extension Box', average_price: 2500, min: 2000, max: 4000 },
    { item_name: 'Reading Lamp', average_price: 3000, min: 2000, max: 5000 },
    { item_name: 'Padlock', average_price: 1000, min: 800, max: 1500 },
    { item_name: 'Hotplate', average_price: 8000, min: 6000, max: 10000 },

    // Fashion
    { item_name: 'Vintage Shirt', average_price: 4000, min: 3000, max: 6000 },
    { item_name: 'Jean Trouser', average_price: 5000, min: 4000, max: 8000 },
    { item_name: 'Nike Slides', average_price: 3500, min: 2500, max: 5000 },
    { item_name: 'Tote Bag', average_price: 2000, min: 1500, max: 3000 },

    // Services
    { item_name: 'Haircut', average_price: 1000, min: 500, max: 2000 },
    { item_name: 'Phone Repair (Screen)', average_price: 15000, min: 10000, max: 25000 },
    { item_name: 'Laundry (Bag)', average_price: 2000, min: 1500, max: 3000 }
];

async function seedPrices() {
    console.log("Seeding Market Prices...");
    try {
        // Clear existing to avoid duplicates/confusion for this demo
        await db.execute({ sql: "DELETE FROM market_prices" });

        for (const item of marketCheck) {
            await db.execute({
                sql: "INSERT INTO market_prices (item_name, average_price, min_price, max_price) VALUES (?, ?, ?, ?)",
                args: [item.item_name, item.average_price, item.min, item.max]
            });
            console.log(`Inserted price guard for: ${item.item_name} `);
        }
        console.log("Market prices seeded successfully.");
    } catch (err) {
        console.error("Error seeding prices:", err);
    }
    process.exit(0);
}

seedPrices();
