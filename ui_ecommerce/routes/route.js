const express = require("express");
const router = express.Router();
const { db } = require('../db'); // Correctly import the database
const axios = require('axios');
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || "sk_test_YOUR_KEY_HERE"; 

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
router.get('/seller/dashboard', (req, res) => {
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

// --- 4. SELLER ACTIONS ---
router.post('/seller/add-product', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const { title, price, description, image } = req.body;
    db.run("INSERT INTO products (name, price, description, image_url, seller_id) VALUES (?, ?, ?, ?, ?)", 
        [title, price, description, image, req.session.user.id], (err) => {
        if (err) console.log(err);
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
// 1. GET: Buyer Dashboard (Now with Wishcart!)
router.get('/buyer/dashboard', (req, res) => {
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

        // B. Fetch Wishcart Items (JOIN with Products to get details)
        const cartQuery = `
            SELECT cart.id as cart_id, products.* FROM cart 
            JOIN products ON cart.product_id = products.id 
            WHERE cart.user_id = ?
        `;

        db.all(cartQuery, [buyerId], (err, cartItems) => {
            if (err) cartItems = [];

            // C. Get Fresh User Data
            db.get("SELECT * FROM users WHERE id = ?", [buyerId], (err, freshUser) => {
                res.render('buyer_dashboard', {
                    user: freshUser || req.session.user,
                    orders: orders,
                    cartItems: cartItems, // Pass the cart items to the view
                    csrfToken: req.csrfToken ? req.csrfToken() : ''
                });
            });
        });
    });
});

// 2. POST: Buyer Confirms Receipt (The "Release Money" Button)
router.post('/order/:id/confirm/buyer', (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const orderId = req.params.id;

    // Logic:
    // 1. Mark order as buyer_confirmed = 1
    // 2. Mark order as escrow_released = 1
    // 3. Move money from 'Pending' to Seller's 'Wallet' (This would be a transaction in a real bank app)
    
    // For now, we update the status flags in the database
    const updateQuery = `
        UPDATE orders 
        SET buyer_confirmed = 1, escrow_released = 1, status = 'completed' 
        WHERE id = ? AND buyer_id = ?
    `;

    db.run(updateQuery, [orderId, req.session.user.id], function(err) {
        if (err) console.error(err);
        
        // Optional: You could write a query here to add money to the Seller's wallet_balance
        // db.run("UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = (SELECT seller_id FROM products ...)")

        // --- CART / WISHCART ROUTES ---

        // 2. POST: Add to Cart
        router.post('/cart/add', (req, res) => {
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
                    res.redirect('/buyer/dashboard'); // Send them to dashboard to see it
                });
            });
        });

        // 3. POST: Remove from Cart
        router.post('/cart/remove', (req, res) => {
            if (!req.session.user) return res.redirect('/login');
            
            const { cart_id } = req.body;
            db.run("DELETE FROM cart WHERE id = ?", [cart_id], (err) => {
                res.redirect('/buyer/dashboard');
            });
        });
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
router.get('/buy/:id', (req, res) => {
    // Security: Must be logged in
    if (!req.session.user) return res.redirect('/login');

    const productId = req.params.id;

    db.get("SELECT * FROM products WHERE id = ?", [productId], (err, product) => {
        if (err || !product) return res.redirect('/');

        // LOGIC: Calculate Service Fee (e.g., 5% of price)
        const serviceFee = product.price * 0.05; 
        const total = product.price + serviceFee;

        res.render('checkout', {
            user: req.session.user,
            product: product,
            serviceFee: serviceFee,
            total: total,
            csrfToken: req.csrfToken ? req.csrfToken() : ''
        });
    });
});

// 2. POST: Initialize Payment
router.post('/paystack/initialize', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const { productId, amount, serviceFee, sellerAmount } = req.body;
    const user = req.session.user;

    // A. Create a unique reference for this transaction
    const reference = 'TXN_' + Date.now() + '_' + user.id;

    // B. Save "Pending" Order in DB immediately
    // This ensures we know a user attempted to buy something
    const insertQuery = `
        INSERT INTO orders 
        (buyer_id, product_id, amount, service_fee, seller_amount, status, payment_reference, buyer_confirmed, seller_confirmed) 
        VALUES (?, ?, ?, ?, ?, 'pending', ?, 0, 0)
    `;

    db.run(insertQuery, [user.id, productId, amount, serviceFee, sellerAmount, reference], async function(err) {
        if (err) {
            console.error("DB Error:", err);
            return res.send("Error processing order.");
        }

        // C. Call Paystack API
        try {
            const response = await axios.post(
                'https://api.paystack.co/transaction/initialize',
                {
                    email: user.username + "@example.com", // In real app, use real email
                    amount: Math.round(amount * 100), // Convert to Kobo (Naira * 100)
                    reference: reference,
                    callback_url: "http://localhost:3000/paystack/callback"
                },
                {
                    headers: {
                        Authorization: `Bearer ${PAYSTACK_SECRET}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            // D. Redirect User to Paystack Payment Page
            res.redirect(response.data.data.authorization_url);

        } catch (apiError) {
            console.error("Paystack Error:", apiError.response ? apiError.response.data : apiError.message);
            res.send("Payment initialization failed.");
        }
    });
});

// 3. GET: Paystack Callback (Verification)
router.get('/paystack/callback', async (req, res) => {
    const reference = req.query.reference;

    if (!reference) return res.redirect('/');

    try {
        // A. Verify Transaction with Paystack
        const verify = await axios.get(
            `https://api.paystack.co/transaction/verify/${reference}`,
            { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } }
        );

        if (verify.data.data.status === 'success') {
            // B. Payment Successful! Update Order in DB to 'paid' (or 'processing')
            // Note: In our app logic, 'pending' delivery is the state after payment.
            // We can use a status like 'paid_pending_delivery'.
            
            db.run(
                "UPDATE orders SET status = 'paid_pending_delivery' WHERE payment_reference = ?", 
                [reference], 
                (err) => {
                    if (err) console.error(err);
                    // Redirect to Dashboard to see the new order
                    res.redirect('/buyer/dashboard');
                }
            );
        } else {
            res.send("Payment verification failed.");
        }

    } catch (error) {
        console.error(error);
        res.send("Error verifying payment.");
    }
});

// --- ADVERTISING ROUTES ---

// 1. GET: Show Ad Purchase Page
router.get('/ads/buy', (req, res) => {
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
router.post('/ads/paystack/initialize', async (req, res) => {
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
    // We store the 'durationDays' in the 'category' column temporarily or a separate column if available.
    // For this schema, we will calculate expiry LATER on success, so we just store status='pending'.
    const insertQuery = `
        INSERT INTO ads (seller_id, message, amount, category, status, payment_reference, expiry_date) 
        VALUES (?, ?, ?, ?, 'pending', ?, 0)
    `;

    // We store 'durationDays' in the category column temporarily to retrieve it later
    db.run(insertQuery, [user.id, message, price, durationDays.toString(), reference], async (err) => {
        if (err) {
            console.error(err);
            return res.send("Error creating ad.");
        }

        // B. Call Paystack
        try {
            const response = await axios.post(
                'https://api.paystack.co/transaction/initialize',
                {
                    email: user.username + "@example.com",
                    amount: price * 100, // In Kobo
                    reference: reference,
                    callback_url: "http://localhost:3000/ads/paystack/callback"
                },
                {
                    headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
                }
            );
            res.redirect(response.data.data.authorization_url);
        } catch (error) {
            console.error(error);
            res.send("Payment failed.");
        }
    });
});

// 3. GET: Ad Payment Callback
router.get('/ads/paystack/callback', async (req, res) => {
    const reference = req.query.reference;

    if (!reference) return res.redirect('/seller/dashboard');

    try {
        const verify = await axios.get(
            `https://api.paystack.co/transaction/verify/${reference}`,
            { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } }
        );

        if (verify.data.data.status === 'success') {
            
            // 1. Retrieve the pending Ad to get the duration we saved in 'category'
            db.get("SELECT * FROM ads WHERE payment_reference = ?", [reference], (err, ad) => {
                if (err || !ad) return res.redirect('/seller/dashboard');

                // 2. Calculate Expiry Date
                const durationDays = parseInt(ad.category); // Retrieve days (1, 3, or 7)
                const now = new Date();
                const expiryDate = new Date(now.setDate(now.getDate() + durationDays));
                
                // Convert to Unix Timestamp (seconds) or keep as ISO string depending on your DB preference.
                // SQLite usually works well with Timestamps (integers).
                const expiryTimestamp = Math.floor(expiryDate.getTime() / 1000);

                // 3. Activate the Ad
                db.run(
                    "UPDATE ads SET status = 'active', expiry_date = ? WHERE payment_reference = ?", 
                    [expiryTimestamp, reference], 
                    (err) => {
                        res.redirect('/seller/dashboard'); // Done!
                    }
                );
            });

        } else {
            res.send("Ad payment verification failed.");
        }
    } catch (error) {
        console.error(error);
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