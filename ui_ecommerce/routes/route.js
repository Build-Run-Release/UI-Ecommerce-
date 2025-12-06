const express = require("express");
const router = express.Router();
const { db } = require('../db'); // Correctly import the database
const axios = require('axios');
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || "sk_test_YOUR_KEY_HERE";

// --- PASTE THIS AT THE TOP OF routes/route.js ---

// --- 1. SETUP MULTER FOR IMAGE UPLOADS ---
const multer = require('multer');
const path = require('path');

// Configure where to save images
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/'); // Save to 'uploads' folder
    },
    filename: function (req, file, cb) {
        // Rename file to avoid duplicates (e.g., image-123456789.jpg)
        cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

const checkBan = (req, res, next) => {
    // 1. If user is not logged in, skip (let the auth middleware handle it)
    if (!req.user) return next();

    // 2. Check if user is banned
    if (req.user.is_banned) {
        // Check if it's a temporary ban that has expired
        if (req.user.ban_expires) {
            const currentDate = new Date();
            const expiryDate = new Date(req.user.ban_expires);

            // If ban is over, let them pass
            if (currentDate > expiryDate) {
                return next();
            }
        }
        // If we are here, they are banned. Show the banned page.
        return res.render('banned', { user: req.user });
    }

    // 3. Not banned? Proceed.
    next();
};

// ------------------------------------------------

// --- 1. HOME PAGE ROUTE (Now with Search!) ---
router.get("/", (req, res) => {
    const user = req.session ? req.session.user : null;
    const searchTerm = req.query.search || ""; // Get what they typed (or empty)

    // A. Build the Product Query
    let productQuery = "SELECT * FROM products";
    let params = [];

    // If they searched, filter by Title OR Description
    if (searchTerm) {
        productQuery += " WHERE title LIKE ? OR description LIKE ?";
        // The % symbols are wildcards (matches anything before or after)
        params = [`%${searchTerm}%`, `%${searchTerm}%`];
    }

    // Order by newest first
    productQuery += " ORDER BY id DESC";

    db.all(productQuery, params, (err, products) => {
        if (err) products = [];

        // B. Fetch Ads (Only active ones)
        // Note: In a real app, you filter WHERE expiry_date > Date.now()
        db.all("SELECT * FROM ads WHERE status = 'active'", [], (err, ads) => {
            if (err) ads = [];

            res.render("index", {
                user: user,
                products: products,
                ads: ads,
                searchTerm: searchTerm // Pass this back so we can show "Clear" button
            });
        });
    });
});

// --- 2. AUTHENTICATION (Login/Signup/Logout) ---
router.get("/signup", (req, res) => res.render("signup", { error: null, csrfToken: req.csrfToken ? req.csrfToken() : '' }));

router.post("/signup", (req, res) => {
    const { username, password, role } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, row) => {
        if (row) return res.render('signup', { error: "Username taken!", csrfToken: req.csrfToken ? req.csrfToken() : '' });
        db.run("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", [username, password, role], (err) => {
            if (err) return res.render('signup', { error: "Error creating user", csrfToken: req.csrfToken ? req.csrfToken() : '' });
            res.redirect('/login');
        });
    });
});

router.get("/login", (req, res) => res.render("login", { error: null, csrfToken: req.csrfToken ? req.csrfToken() : '' }));

router.post("/login", (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (!user || user.password !== password) return res.render('login', { error: "Invalid credentials", csrfToken: req.csrfToken ? req.csrfToken() : '' });
        req.session.user = user;
        if (user.role === 'admin') res.redirect('/admin_dashboard');
        else if (user.role === 'seller') res.redirect('/seller/dashboard');
        else res.redirect('/');
    });
});

router.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

// --- 3. SELLER DASHBOARD ---
router.get('/seller/dashboard', checkBan, (req, res) => {
    if (!req.session.user || req.session.user.role !== 'seller') return res.redirect('/login');
    const sellerId = req.session.user.id;
    db.all("SELECT * FROM products WHERE seller_id = ?", [sellerId], (err, products) => {
        if (err) products = [];
        db.all("SELECT * FROM orders WHERE seller_id = ?", [sellerId], (err, orders) => {
            if (err) orders = [];
            db.get("SELECT * FROM users WHERE id = ?", [sellerId], (err, user) => {
                res.render('seller_dashboard', { user: user || req.session.user, products: products, orders: orders, csrfToken: req.csrfToken ? req.csrfToken() : '' });
            });
        });
    });
});

// --- SELLER: ADD PRODUCT ROUTE (With Image Upload) ---
// Notice we added 'upload.single('image')' middleware
router.post('/seller/add-product', checkBan, upload.single('image'), (req, res) => {

    // 1. Security Check
    if (!req.session.user) return res.redirect('/login');

    const { title, price, description } = req.body;

    // 2. Get the filename if an image was uploaded
    const imageFilename = req.file ? req.file.filename : null;

    // 3. Insert into Database
    db.run(
        "INSERT INTO products (title, price, description, image_url, seller_id) VALUES (?, ?, ?, ?, ?)",
        [title, price, description, imageFilename, req.session.user.id],
        (err) => {
            if (err) {
                console.error("Error adding product:", err);
                return res.send("Error publishing product.");
            }
            res.redirect('/seller/dashboard');
        }
    );
});

// --- SELLER: EDIT PRODUCT ROUTE ---
router.post('/seller/product/:id/edit', checkBan, (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const { title, price, description } = req.body;
    const productId = req.params.id;
    const sellerId = req.session.user.id;

    // Update query
    const query = "UPDATE products SET title = ?, price = ?, description = ? WHERE id = ? AND seller_id = ?";

    db.run(query, [title, price, description, productId, sellerId], (err) => {
        if (err) {
            console.error("Error updating product:", err);
            return res.send("Error updating product.");
        }
        res.redirect('/seller/dashboard');
    });
});

router.post('/seller/onboard', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const { bank_name, account_number, bank_code } = req.body;
    db.run("UPDATE users SET bank_name = ?, account_number = ?, bank_code = ? WHERE id = ?",
        [bank_name, account_number, bank_code, req.session.user.id], (err) => {
            res.redirect('/seller/dashboard');
        });
});
// --- SELLER: DELETE PRODUCT ROUTE ---
router.post('/seller/product/:id/delete', (req, res) => {
    // 1. Check if user is logged in
    if (!req.session.user) return res.redirect('/login');

    const productId = req.params.id;
    const sellerId = req.session.user.id;

    // 2. Delete the product ONLY if it belongs to this seller
    const query = "DELETE FROM products WHERE id = ? AND seller_id = ?";

    db.run(query, [productId, sellerId], (err) => {
        if (err) console.error("Error deleting product:", err);
        res.redirect('/seller/dashboard');
    });
});

// --- BUYER DASHBOARD & ACTIONS ---

// 1. GET: Buyer Dashboard
router.get('/buyer/dashboard', checkBan, (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const buyerId = req.session.user.id;

    // A. Fetch Orders
    const ordersQuery = `
        SELECT orders.*, products.title as product_title, products.image_url 
        FROM orders 
        LEFT JOIN products ON orders.product_id = products.id 
        WHERE orders.buyer_id = ? 
        ORDER BY orders.id DESC
    `;

    db.all(ordersQuery, [buyerId], (err, orders) => {
        if (err) orders = [];

        // B. Fetch Wishcart Items
        const cartQuery = `
            SELECT cart.id as cart_id, products.* FROM cart 
            JOIN products ON cart.product_id = products.id 
            WHERE cart.user_id = ?
        `;

        db.all(cartQuery, [buyerId], (err, cartItems) => {
            if (err) cartItems = [];

            // C. Get Fresh User Data & Render
            db.get("SELECT * FROM users WHERE id = ?", [buyerId], (err, freshUser) => {
                res.render('buyer_dashboard', {
                    user: freshUser || req.session.user,
                    orders: orders,
                    cartItems: cartItems,
                    csrfToken: req.csrfToken ? req.csrfToken() : '',
                    // PASS THE PAYSTACK KEY HERE
                    paystackKey: process.env.PAYSTACK_PUBLIC_KEY
                });
            });
        });
    });
});

// 2. POST: Buyer Confirms Receipt
router.post('/order/:id/confirm/buyer', checkBan, (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const orderId = req.params.id;

    // Mark as confirmed and released
    const updateQuery = `
        UPDATE orders 
        SET buyer_confirmed = 1, escrow_released = 1, status = 'completed' 
        WHERE id = ? AND buyer_id = ?
    `;

    db.run(updateQuery, [orderId, req.session.user.id], function (err) {
        if (err) console.error(err);

        // Redirect back to dashboard to update the UI
        res.redirect('/buyer/dashboard');
    });
});

// --- CART / WISHCART ROUTES (Now properly separated) ---

// 3. POST: Add to Cart
router.post('/cart/add', checkBan, (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const { product_id } = req.body;
    const userId = req.session.user.id;

    // Check if already in cart to prevent duplicates
    db.get("SELECT * FROM cart WHERE user_id = ? AND product_id = ?", [userId, product_id], (err, row) => {
        if (row) {
            // Already added, just go back
            return res.redirect('/');
        }

        db.run("INSERT INTO cart (user_id, product_id) VALUES (?, ?)", [userId, product_id], (err) => {
            // Send them to dashboard to see their cart
            res.redirect('/buyer/dashboard');
        });
    });
});

// 4. POST: Remove from Cart
router.post('/cart/remove', checkBan, (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const { cart_id } = req.body;

    db.run("DELETE FROM cart WHERE id = ?", [cart_id], (err) => {
        res.redirect('/buyer/dashboard');
    });
});
// --- ADMIN ROUTES ---

// 1. GET: Admin Dashboard
router.get('/admin_dashboard', (req, res) => {
    // Security: Strict check for Admin role
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.redirect('/login');
    }

    // A. Fetch All Users
    db.all("SELECT * FROM users ORDER BY id DESC", [], (err, users) => {
        if (err) users = [];

        // B. Fetch Platform Stats (Total Orders & Total Revenue from Service Fees)
        // 'service_fee' is the column in your orders table
        const statsQuery = "SELECT COUNT(*) as total_orders, SUM(service_fee) as total_revenue FROM orders";

        db.get(statsQuery, [], (err, stats) => {
            if (err) stats = { total_orders: 0, total_revenue: 0 };

            res.render('admin_dashboard', {
                user: req.session.user,
                users: users,
                stats: stats,
                csrfToken: req.csrfToken ? req.csrfToken() : ''
            });
        });
    });
});

// 2. POST: Block/Unblock User
router.post('/admin/user/:id/toggle-block', (req, res) => {
    // Security Check
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).send("Unauthorized");
    }

    const targetUserId = req.params.id;

    // First, check current status
    db.get("SELECT is_blocked FROM users WHERE id = ?", [targetUserId], (err, user) => {
        if (err || !user) return res.redirect('/admin_dashboard');

        // Toggle logic: If blocked(1) -> make 0. If active(0) -> make 1.
        const newStatus = user.is_blocked ? 0 : 1;

        db.run("UPDATE users SET is_blocked = ? WHERE id = ?", [newStatus, targetUserId], (err) => {
            if (err) console.error("Error updating user status:", err);
            res.redirect('/admin_dashboard');
        });
    });
});

// At the top of route.js (if not already there)
// --- CHECKOUT & PAYMENT ROUTES ---

// 1. GET: Show Checkout Page
router.get('/buy/:id', checkBan, (req, res) => {
    // Security: Must be logged in
    if (!req.session.user) return res.redirect('/login');

    const productId = req.params.id;

    db.get("SELECT * FROM products WHERE id = ?", [productId], (err, product) => {
        if (err || !product) {
            console.error("Product not found");
            return res.redirect('/');
        }

        // LOGIC: Calculate Service Fee (10%)
        const price = parseFloat(product.price);
        const serviceFee = Math.ceil(price * 0.10); // 10% Fee
        const total = price + serviceFee;

        res.render('checkout', {
            user: req.session.user,
            product: product,
            serviceFee: serviceFee,
            total: total,
            csrfToken: req.csrfToken ? req.csrfToken() : ''
        });
    });
});

// 2. POST: Initialize Paystack Payment
router.post('/paystack/initialize', checkBan, async (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const { productId, amount, serviceFee, sellerAmount } = req.body;
    const user = req.session.user;

    // A. Generate a Unique Reference
    const reference = 'ORD_' + Date.now() + '_' + user.id;

    // B. Create "Pending" Order in Database
    // IMPORTANT: We select the seller_id from the products table so the seller receives the order!
    const insertQuery = `
        INSERT INTO orders 
        (buyer_id, seller_id, product_id, amount, service_fee, seller_amount, status, payment_reference, buyer_confirmed, seller_confirmed, created_at) 
        VALUES (?, (SELECT seller_id FROM products WHERE id = ?), ?, ?, ?, ?, 'pending', ?, 0, 0, datetime('now'))
    `;

    // Note: We pass productId twice (once for the order, once to find the seller)
    db.run(insertQuery, [user.id, productId, productId, amount, serviceFee, sellerAmount, reference], async function (err) {
        if (err) {
            console.error("DB Error creating order:", err);
            return res.send("Error processing order. Please try again.");
        }

        // C. Call Paystack API
        try {
            const response = await axios.post(
                'https://api.paystack.co/transaction/initialize',
                {
                    email: user.username + "@example.com", // In a real app, use user.email
                    amount: Math.round(amount * 100), // Convert to Kobo
                    reference: reference,
                    // UPDATED: Points to your Railway App
                    callback_url: "https://ui-ecommerce-production.up.railway.app/paystack/callback"
                },
                {
                    headers: {
                        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY || 'sk_test_YOUR_KEY_HERE'}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            // D. Redirect User to Paystack
            res.redirect(response.data.data.authorization_url);

        } catch (apiError) {
            console.error("Paystack API Error:", apiError.response ? apiError.response.data : apiError.message);
            res.send("Payment initialization failed.");
        }
    });
});

// // 3. GET: Paystack Verification (Handles BOTH Orders & Wallet Funding)
router.get('/paystack/verify', async (req, res) => {
    const reference = req.query.reference;
    if (!reference) return res.redirect('/');

    try {
        // A. Verify the Transaction with Paystack
        const verify = await axios.get(
            `https://api.paystack.co/transaction/verify/${reference}`,
            {
                headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY || 'sk_test_YOUR_KEY_HERE'}` }
            }
        );

        if (verify.data.data.status === 'success') {
            // Paystack returns amount in Kobo, convert to Naira
            const amountPaid = verify.data.data.amount / 100;
            const currentUser = req.session.user;

            // B. Check if this reference belongs to an existing ORDER
            db.get("SELECT * FROM orders WHERE payment_reference = ?", [reference], (err, order) => {
                if (order) {
                    // --- SCENARIO 1: IT IS A PRODUCT PURCHASE ---
                    db.run(
                        "UPDATE orders SET status = 'paid_pending_delivery' WHERE payment_reference = ?",
                        [reference],
                        (err) => {
                            if (err) console.error(err);
                            res.redirect('/buyer/dashboard');
                        }
                    );
                } else {
                    // --- SCENARIO 2: IT IS WALLET FUNDING ---
                    // Since it's not in the orders table, we add the money to the user's wallet

                    // Security: Ensure user is logged in
                    if (!currentUser) return res.redirect('/login');

                    db.run(
                        "UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?",
                        [amountPaid, currentUser.id],
                        (err) => {
                            if (err) console.error(err);
                            console.log(`Wallet funded: +₦${amountPaid} for User ${currentUser.id}`);
                            res.redirect('/buyer/dashboard');
                        }
                    );
                }
            });

        } else {
            res.send("Payment verification failed.");
        }

    } catch (error) {
        console.error("Verification Error:", error.message);
        res.send("Error verifying payment.");
    }
});
// --- ADVERTISING ROUTES ---

// 1. GET: Show Ad Purchase Page
router.get('/ads/buy', checkBan, (req, res) => {
    // Only Sellers can buy ads
    if (!req.session.user || req.session.user.role !== 'seller') {
        return res.redirect('/login');
    }

    res.render('buy_ad', {
        user: req.session.user,
        csrfToken: req.csrfToken ? req.csrfToken() : ''
    });
});

// 2. POST: Initialize Ad Payment
router.post('/ads/paystack/initialize', checkBan, async (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const { message, plan } = req.body;
    const user = req.session.user;

    // Parse the plan (Format: "days_amount")
    // Example: "1_day_500" -> duration=1, price=500
    let durationDays = 1;
    let price = 500;

    if (plan === "3_day_1200") {
        durationDays = 3;
        price = 1200;
    } else if (plan === "7_day_2500") {
        durationDays = 7;
        price = 2500;
    }

    const reference = 'AD_' + Date.now() + '_' + user.id;

    // A. Create Pending Ad in DB
    // We store 'durationDays' in the 'category' column temporarily to retrieve it later upon success
    const insertQuery = `
        INSERT INTO ads (seller_id, message, amount, category, status, payment_reference, expiry_date) 
        VALUES (?, ?, ?, ?, 'pending', ?, 0)
    `;

    db.run(insertQuery, [user.id, message, price, durationDays.toString(), reference], async (err) => {
        if (err) {
            console.error(err);
            return res.send("Error creating ad.");
        }

        // B. Call Paystack API
        try {
            const response = await axios.post(
                'https://api.paystack.co/transaction/initialize',
                {
                    email: user.username + "@example.com", // In a real app, use user.email
                    amount: price * 100, // Convert to Kobo
                    reference: reference,
                    // UPDATED: Points to your Live Railway App
                    callback_url: "https://ui-ecommerce-production.up.railway.app/ads/paystack/callback"
                },
                {
                    headers: {
                        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY || 'sk_test_YOUR_KEY_HERE'}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            // C. Redirect to Paystack
            res.redirect(response.data.data.authorization_url);

        } catch (error) {
            console.error("Paystack Error:", error.response ? error.response.data : error.message);
            res.send("Payment initialization failed.");
        }
    });
});

// 3. GET: Ad Payment Callback
router.get('/ads/paystack/callback', async (req, res) => {
    const reference = req.query.reference;

    if (!reference) return res.redirect('/seller/dashboard');

    try {
        // A. Verify Transaction
        const verify = await axios.get(
            `https://api.paystack.co/transaction/verify/${reference}`,
            {
                headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY || 'sk_test_YOUR_KEY_HERE'}` }
            }
        );

        if (verify.data.data.status === 'success') {

            // 1. Retrieve the pending Ad to get the duration
            db.get("SELECT * FROM ads WHERE payment_reference = ?", [reference], (err, ad) => {
                if (err || !ad) return res.redirect('/seller/dashboard');

                // 2. Calculate Expiry Date
                const durationDays = parseInt(ad.category); // Retrieve days stored earlier
                const now = new Date();
                const expiryDate = new Date(now.setDate(now.getDate() + durationDays));

                // Convert to Unix Timestamp (seconds)
                const expiryTimestamp = Math.floor(expiryDate.getTime() / 1000);

                // 3. Activate the Ad
                db.run(
                    "UPDATE ads SET status = 'active', expiry_date = ? WHERE payment_reference = ?",
                    [expiryTimestamp, reference],
                    (err) => {
                        if (err) console.error(err);
                        res.redirect('/seller/dashboard'); // Done!
                    }
                );
            });

        } else {
            res.send("Ad payment verification failed.");
        }
    } catch (error) {
        console.error("Verification Error:", error);
        res.redirect('/seller/dashboard');
    }
});

// GET: Settings Page
router.get('/settings', (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    // You can create a simple 'settings.ejs' view later.
    // For now, we just render a simple message.
    res.send(`
        <h1>Settings</h1>
        <p>Profile settings for ${req.session.user.username} coming soon.</p>
        <a href="/">Go Back</a>
    `);
});

module.exports = router;