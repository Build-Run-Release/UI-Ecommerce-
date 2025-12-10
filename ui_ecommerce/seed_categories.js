const { db } = require('./db');

const categories = [
    "Hostel Essentials",
    "Campus Food & Provisions",
    "Gadgets & Tech",
    "Textbooks & Materials",
    "Fashion & Wears",
    "Services",
    "Miscellaneous"
];

async function seedCategories() {
    console.log("Seeding Categories...");
    try {
        for (const cat of categories) {
            await db.execute({
                sql: "INSERT INTO categories (name) VALUES (?) ON CONFLICT (name) DO NOTHING",
                args: [cat]
            });
            console.log(`Ensured category: ${cat}`);
        }
        console.log("Categories seeded successfully.");
    } catch (err) {
        console.error("Error seeding categories:", err);
    }
    process.exit(0);
}

seedCategories();
