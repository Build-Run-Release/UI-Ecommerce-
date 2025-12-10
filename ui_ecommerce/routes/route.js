const express = require("express");
const router = express.Router();
const { db } = require('../db'); // Correctly import the database
const axios = require('axios');
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
if (!PAYSTACK_SECRET) {
    console.warn("WARNING: PAYSTACK_SECRET_KEY is not set. Payments will fail.");
}
const bcrypt = require('bcrypt');
const SALT_ROUNDS = 10;

const csurf = require('csurf');
const cookieParser = require('cookie-parser');

// --- PASTE THIS AT THE TOP OF routes/route.js ---

// --- 1. SETUP CLOUDINARY FOR IMAGE UPLOADS ---
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const path = require('path');

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'ui_ecommerce_products',
        allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
    },
});

const upload = multer({ storage: storage });

const checkBan = (req, res, next) => {
    // 1. If user is not logged in, skip (let the auth middleware handle it)
    if (!req.session.user) return next();

    const user = req.session.user;

    // 2. Check if user is banned
    if (user.is_banned) {
        // Check if it's a temporary ban that has expired
        if (user.ban_expires) {
            const currentDate = new Date();
            const expiryDate = new Date(user.ban_expires);

            // If ban is over, let them pass
            if (currentDate > expiryDate) {
                return next();
            }
        }
        // If we are here, they are banned. Show the banned page.
        return res.render('banned', { user: user });
    }
    // 3. Not banned? Proceed.
    next();
};

const csrfProtection = csurf({ cookie: true });

// Specific Middleware to pass token to views
const passCsrfToken = (req, res, next) => {
    res.locals.csrfToken = req.csrfToken();
    next();
};

const noCache = (req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
};

// --- SPECIAL ROUTES (Uploads) ---
// We must define this BEFORE the global CSRF middleware so we can insert 'upload' middleware first.
// This allows Multer to parse the body (and the _csrf field inside it) before csurf validates it.

router.post('/seller/add-product', checkBan, upload.single('image'), csrfProtection, async (req, res) => {

    // 1. Security Check
    if (!req.session.user) return res.redirect('/login');

    const { title, price, description } = req.body;
    const submittedPrice = parseFloat(price);

    // 2. Get the full Cloudinary URL if uploaded
    const imageUrl = req.file ? req.file.path : null;

    try {
        // --- PRICE GUARD IMPLEMENTATION ---
        const { rows: marketPrices } = await db.execute({ sql: "SELECT * FROM market_prices" });
        // Simple fuzzy match: check if product title contains the market item name
        const match = marketPrices.find(p => title.toLowerCase().includes(p.item_name.toLowerCase()));

        if (match) {
            // Rule: Price cannot be more than 20% above max, or less than 50% of min (suspicious)
            const maxAllowed = match.max_price * 1.2;
            const minAllowed = match.min_price * 0.5;

            if (submittedPrice > maxAllowed) {
                return res.status(400).send(`Price Guard Alert: Your price (₦${submittedPrice}) is significantly higher than the market average for ${match.item_name} (₦${match.average_price}). Max allowed: ₦${maxAllowed}.`);
            }
            // Optional: Block extremely low prices too
            if (submittedPrice < minAllowed) {
                return res.status(400).send(`Price Guard Alert: Your price is suspiciously low. Market average for ${match.item_name} is ₦${match.average_price}.`);
            }
        }
        // ----------------------------------

        // 3. Insert into Database
        await db.execute({
            sql: "INSERT INTO products (title, price, description, category, image_url, seller_id) VALUES (?, ?, ?, ?, ?, ?)",
            args: [title, submittedPrice, description, req.body.category || 'Other', imageUrl, req.session.user.id]
        });
        res.redirect('/seller/dashboard');
    } catch (err) {
        console.error("Error adding product:", err);
        return res.status(500).send("Error publishing product: " + err.message);
    }
});

// --- APPLY GLOBAL CSRF TO ALL OTHER ROUTES ---
router.use(csrfProtection);
router.use(passCsrfToken);

// ------------------------------------------------

// --- 1. HOME PAGE ROUTE (Now with Search!) ---
router.get("/", async (req, res) => {
    const user = req.session ? req.session.user : null;
    const searchTerm = req.query.search || ""; // Get what they typed (or empty)

    // A. Build the Product Query
    let productQuery = "SELECT * FROM products";
    let params = [];

    // If they searched, filter by Title OR Description
    if (searchTerm) {
        productQuery += " WHERE (title ILIKE ? OR description ILIKE ?)";
        params = [`%${searchTerm}%`, `%${searchTerm}%`];
    }

    // Filter by Category
    const category = req.query.category;
    if (category) {
        if (params.length > 0) {
            productQuery += " AND category = ?";
        } else {
            productQuery += " WHERE category = ?";
        }
        params.push(category);
    }

    // Order by newest first
    productQuery += " ORDER BY id DESC";

    try {
        const { rows: products } = await db.execute({ sql: productQuery, args: params });

        // B. Fetch Ads (Only active ones)
        const { rows: ads } = await db.execute({ sql: "SELECT * FROM ads WHERE status = 'active'" });

        res.render("index", {
            user: user,
            products: products,
            ads: ads,
            searchTerm: searchTerm,
            currentCategory: req.query.category || ''
        });
    } catch (err) {
        console.error(err);
        res.render("index", {
            user: user,
            products: [],
            ads: [],
            searchTerm: searchTerm,
            currentCategory: req.query.category || ''
        });
    }
});

// --- 2. AUTHENTICATION (Login/Signup/Logout) ---
router.get("/signup", (req, res) => res.render("signup", { error: null, csrfToken: req.csrfToken ? req.csrfToken() : '' }));

router.post("/signup", async (req, res) => {
    const { username, password, role } = req.body;
    console.log(`Signup attempt: ${username}, role: ${role}`);
    try {
        const check = await db.execute({ sql: "SELECT * FROM users WHERE username = ?", args: [username] });
        if (check.rows.length > 0) return res.render('signup', { error: "Username taken!", csrfToken: req.csrfToken ? req.csrfToken() : '' });


        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        await db.execute({
            sql: "INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
            args: [username, hashedPassword, role]
        });

        // Auto Login logic
        const userRes = await db.execute({ sql: "SELECT * FROM users WHERE username = ?", args: [username] });
        const user = userRes.rows[0];

        if (user) {
            req.session.user = user;
            if (user.role === 'seller') res.redirect('/seller/dashboard');
            else if (user.role === 'admin') res.redirect('/admin_dashboard');
            else res.redirect('/buyer/dashboard');
        } else {
            console.log("Signup Auto-login failed: User not found after insertion.");
            res.redirect('/login');
        }
    } catch (err) {
        console.error("Signup Error:", err);
        return res.render('signup', { error: "Error creating user", csrfToken: req.csrfToken ? req.csrfToken() : '' });
    }
});

router.get("/login", (req, res) => res.render("login", { error: null, csrfToken: req.csrfToken ? req.csrfToken() : '' }));

router.post("/login", async (req, res) => {
    const { username, password } = req.body;
    try {
        const { rows } = await db.execute({ sql: "SELECT * FROM users WHERE username = ?", args: [username] });
        const user = rows[0];


        if (!user) return res.render('login', { error: "Invalid credentials", csrfToken: req.csrfToken ? req.csrfToken() : '' });

        // --- PASSWORD CHECK & MIGRATION ---
        let match = false;
        const isHashed = user.password.startsWith('$2b$') || user.password.startsWith('$2a$'); // Bcrypt prefixes

        if (isHashed) {
            match = await bcrypt.compare(password, user.password);
        } else {
            // Legacy plain text check
            if (user.password === password) {
                match = true;
                // Lazy Migration: Hash it now!
                const newHash = await bcrypt.hash(password, SALT_ROUNDS);
                await db.execute({ sql: "UPDATE users SET password = ? WHERE id = ?", args: [newHash, user.id] });
                console.log(`Migrated user ${user.username} (ID: ${user.id}) to hashed password.`);
            }
        }

        if (!match) {
            console.log(`Login failed for ${username}: Password mismatch.`);
            return res.render('login', { error: "Invalid credentials", csrfToken: req.csrfToken ? req.csrfToken() : '' });
        }

        console.log(`User ${username} logged in successfully. Role: ${user.role}`);
        req.session.user = user;
        if (user.role === 'admin') res.redirect('/admin_dashboard');
        else if (user.role === 'seller') res.redirect('/seller/dashboard');
        else res.redirect('/');
    } catch (err) {
        console.error("Login Error:", err);
        // DEBUG: Expose full error to UI for production debugging
        res.render('login', { error: "Login failed: " + err.message, csrfToken: req.csrfToken ? req.csrfToken() : '' });
    }
});

router.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

// --- 3. SELLER DASHBOARD ---
router.get('/seller/dashboard', noCache, checkBan, async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'seller') return res.redirect('/login');
    const sellerId = req.session.user.id;
    try {
        const { rows: products } = await db.execute({ sql: "SELECT * FROM products WHERE seller_id = ?", args: [sellerId] });
        const { rows: orders } = await db.execute({ sql: "SELECT * FROM orders WHERE seller_id = ?", args: [sellerId] });
        const { rows: users } = await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [sellerId] });
        const user = users[0];

        res.render('seller_dashboard', { user: user || req.session.user, products: products, orders: orders, csrfToken: req.csrfToken ? req.csrfToken() : '' });
    } catch (err) {
        console.error(err);
        res.render('seller_dashboard', { user: req.session.user, products: [], orders: [], csrfToken: req.csrfToken ? req.csrfToken() : '' });
    }
});

// --- SELLER: ADD PRODUCT ROUTE (With Image Upload) ---
// Notice we added 'upload.single('image')' middleware
// (Moved above to handle Multer ordering)
// router.post('/seller/add-product' ... handled above ...

// --- SELLER: EDIT PRODUCT ROUTE ---
router.post('/seller/product/:id/edit', checkBan, async (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const { title, price, description } = req.body;
    const productId = req.params.id;
    const sellerId = req.session.user.id;

    // Update query
    const query = "UPDATE products SET title = ?, price = ?, description = ?, category = ? WHERE id = ? AND seller_id = ?";

    try {
        await db.execute({
            sql: query,
            args: [title, price, description, req.body.category || 'Other', productId, sellerId]
        });
        res.redirect('/seller/dashboard');
    } catch (err) {
        console.error("Error updating product:", err);
        return res.send("Error updating product.");
    }
});

router.post('/seller/onboard', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const { bank_name, account_number, bank_code } = req.body;
    try {
        await db.execute({
            sql: "UPDATE users SET bank_name = ?, account_number = ?, bank_code = ? WHERE id = ?",
            args: [bank_name, account_number, bank_code, req.session.user.id]
        });
        res.redirect('/seller/dashboard');
    } catch (err) {
        console.error(err);
        res.redirect('/seller/dashboard');
    }
});

// 5. POST: Seller Withdraw
const { createTransferRecipient, initiateTransfer } = require('../utils/payout');
router.post('/seller/withdraw', checkBan, async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'seller') return res.redirect('/login');

    const amount = parseFloat(req.body.amount);
    const sellerId = req.session.user.id;

    if (!amount || amount < 100) return res.send("Minimum withdrawal is ₦100");

    try {
        // 1. Check Balance
        const { rows } = await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [sellerId] });
        const user = rows[0];

        if (user.wallet_balance < amount) return res.send("Insufficient funds.");

        // 2. Get Recipient Code
        let recipientCode = user.paystack_subaccount_code;

        if (!recipientCode || !recipientCode.startsWith("RCP")) {
            // Create one
            // Ensure bank_code exists. If not, ask user to onboard.
            if (!user.bank_code || !user.account_number) {
                return res.send("Please update your bank details in Settings or Onboarding first.");
            }

            const recRes = await createTransferRecipient(user.bank_name, user.account_number, user.bank_code);

            if (recRes.success) {
                recipientCode = recRes.code;
                await db.execute({ sql: "UPDATE users SET paystack_subaccount_code = ? WHERE id = ?", args: [recipientCode, sellerId] });
            } else {
                return res.send("Error creating payout recipient: " + recRes.error);
            }
        }

        // 3. Initiate Transfer
        const txRes = await initiateTransfer(recipientCode, amount);
        if (txRes.success) {
            // Deduct Balance
            await db.execute({ sql: "UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?", args: [amount, sellerId] });
            res.redirect('/seller/dashboard?msg=withdrawal_queued');
        } else {
            res.send("Withdrawal failed: " + txRes.error);
        }

    } catch (err) {
        console.error(err);
        res.send("Error processing withdrawal.");
    }
});

// --- SELLER: DELETE PRODUCT ROUTE ---
router.post('/seller/product/:id/delete', async (req, res) => {
    // 1. Check if user is logged in
    if (!req.session.user) return res.redirect('/login');

    const productId = req.params.id;
    const sellerId = req.session.user.id;

    // 2. Delete the product ONLY if it belongs to this seller
    const query = "DELETE FROM products WHERE id = ? AND seller_id = ?";

    try {
        await db.execute({ sql: query, args: [productId, sellerId] });
        res.redirect('/seller/dashboard');
    } catch (err) {
        console.error("Error deleting product:", err);
        res.redirect('/seller/dashboard');
    }
});

// --- BUYER DASHBOARD & ACTIONS ---

// 1. GET: Buyer Dashboard
router.get('/buyer/dashboard', noCache, checkBan, async (req, res) => {
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

    try {
        const { rows: orders } = await db.execute({ sql: ordersQuery, args: [buyerId] });

        // B. Fetch Wishcart Items
        const cartQuery = `
            SELECT cart.id as cart_id, products.* FROM cart 
            JOIN products ON cart.product_id = products.id 
            WHERE cart.user_id = ?
        `;
        const { rows: cartItems } = await db.execute({ sql: cartQuery, args: [buyerId] });

        // D. Fetch Wishlist Items
        const wishlistQuery = `
            SELECT wishlist.id as wishlist_id, products.* FROM wishlist 
            JOIN products ON wishlist.product_id = products.id 
            WHERE wishlist.user_id = ?
        `;
        const { rows: wishlistItems } = await db.execute({ sql: wishlistQuery, args: [buyerId] });

        // C. Get Fresh User Data & Render
        const { rows: userRes } = await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [buyerId] });
        const freshUser = userRes[0];

        res.render('buyer_dashboard', {
            user: freshUser || req.session.user,
            orders: orders,
            cartItems: cartItems,
            wishlistItems: wishlistItems,
            csrfToken: req.csrfToken ? req.csrfToken() : '',
            paystackKey: process.env.PAYSTACK_PUBLIC_KEY
        });
    } catch (err) {
        console.error(err);
        res.redirect('/login');
    }
});

// 2. POST: Buyer Confirms Receipt
router.post('/order/:id/confirm/buyer', checkBan, async (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const orderId = req.params.id;
    const buyerId = req.session.user.id;

    try {
        // 1. Get the order details to find the seller and the amount
        const { rows } = await db.execute({ sql: "SELECT * FROM orders WHERE id = ? AND buyer_id = ?", args: [orderId, buyerId] });
        const order = rows[0];

        if (!order) {
            console.error("Order not found or access denied");
            return res.redirect('/buyer/dashboard');
        }

        if (order.status === 'completed') {
            return res.redirect('/buyer/dashboard');
        }

        const sellerId = order.seller_id;
        const sellerAmount = order.seller_amount;

        // 2. Update Order
        const updateOrder = `
            UPDATE orders 
            SET buyer_confirmed = 1, escrow_released = 1, status = 'completed' 
            WHERE id = ?
        `;
        await db.execute({ sql: updateOrder, args: [orderId] });

        // 3. Credit Seller's Wallet
        const updateWallet = "UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?";
        await db.execute({ sql: updateWallet, args: [sellerAmount, sellerId] });

        console.log(`Verified Order #${orderId}: Released ₦${sellerAmount} to Seller #${sellerId}`);
        res.redirect('/buyer/dashboard');

    } catch (err) {
        console.error("Error confirming order:", err);
        return res.redirect('/buyer/dashboard?error=update_failed');
    }
});

// 3. POST: Seller Confirms Sending
router.post('/order/:id/confirm/seller', checkBan, async (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const orderId = req.params.id;

    // Mark as seller_confirmed
    const updateQuery = `
        UPDATE orders 
        SET seller_confirmed = 1, status = 'shipped' 
        WHERE id = ? AND seller_id = ?
    `;

    try {
        await db.execute({ sql: updateQuery, args: [orderId, req.session.user.id] });
        res.redirect('/seller/dashboard');
    } catch (err) {
        console.error(err);
        res.redirect('/seller/dashboard');
    }
});

// --- CART / WISHCART ROUTES (Now properly separated) ---

// 3. POST: Add to Cart
router.post('/cart/add', checkBan, async (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const { product_id } = req.body;
    const userId = req.session.user.id;

    try {
        // Check if already in cart to prevent duplicates
        const { rows } = await db.execute({ sql: "SELECT * FROM cart WHERE user_id = ? AND product_id = ?", args: [userId, product_id] });
        if (rows.length > 0) {
            // Already added, just go back
            return res.redirect('/');
        }

        await db.execute({ sql: "INSERT INTO cart (user_id, product_id) VALUES (?, ?)", args: [userId, product_id] });
        // Send them to dashboard to see their cart
        res.redirect('/buyer/dashboard');
    } catch (err) {
        console.error(err);
        res.redirect('back');
    }
});

// 4. POST: Remove from Cart
router.post('/cart/remove', checkBan, async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const { cart_id } = req.body;
    try {
        await db.execute({ sql: "DELETE FROM cart WHERE id = ?", args: [cart_id] });
        res.redirect('/buyer/dashboard');
    } catch (err) {
        console.error(err);
        res.redirect('/buyer/dashboard');
    }
});

// 5. POST: Add to Wishlist
router.post('/wishlist/add', checkBan, async (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const { product_id } = req.body;
    const userId = req.session.user.id;

    try {
        // Check if already in wishlist
        const { rows } = await db.execute({ sql: "SELECT * FROM wishlist WHERE user_id = ? AND product_id = ?", args: [userId, product_id] });
        if (rows.length > 0) return res.redirect('/');

        await db.execute({ sql: "INSERT INTO wishlist (user_id, product_id) VALUES (?, ?)", args: [userId, product_id] });
        // UX Improvement: Stay on the same page
        res.redirect(req.get('Referer') || '/');
    } catch (err) {
        console.error(err);
        res.redirect(req.get('Referer') || '/');
    }
});

// 6. POST: Remove from Wishlist
router.post('/wishlist/remove', checkBan, async (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const { wishlist_id } = req.body;

    try {
        await db.execute({ sql: "DELETE FROM wishlist WHERE id = ?", args: [wishlist_id] });
        res.redirect('/buyer/dashboard?tab=wishlist');
    } catch (err) {
        console.error(err);
        res.redirect('/buyer/dashboard?tab=wishlist');
    }
});

// --- SETTINGS ROUTES ---

// 1. GET: Settings Page
// 1. GET: Settings Page
router.get('/settings', noCache, checkBan, async (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    // Refresh user data
    try {
        const { rows } = await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [req.session.user.id] });
        const user = rows[0];
        res.render('settings', {
            user: user || req.session.user,
            csrfToken: req.csrfToken ? req.csrfToken() : ''
        });
    } catch (err) {
        console.error(err);
        res.render('settings', {
            user: req.session.user,
            csrfToken: req.csrfToken ? req.csrfToken() : ''
        });
    }
});

// 2. POST: Update Profile
// 2. POST: Update Profile
router.post('/settings/profile', checkBan, async (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const { email, bank_name, account_number } = req.body;

    try {
        await db.execute({
            sql: "UPDATE users SET email = ?, bank_name = ?, account_number = ? WHERE id = ?",
            args: [email, bank_name, account_number, req.session.user.id]
        });
        // Update session data
        req.session.user.email = email;
        req.session.user.bank_name = bank_name;
        req.session.user.account_number = account_number;
        res.redirect('/settings?msg=profile_updated');
    } catch (err) {
        console.error(err);
        res.redirect('/settings');
    }
});

// 3. POST: Change Password
// 3. POST: Change Password
router.post('/settings/password', checkBan, async (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const { current_password, new_password } = req.body;
    const userId = req.session.user.id;

    try {
        const { rows } = await db.execute({ sql: "SELECT password FROM users WHERE id = ?", args: [userId] });
        const user = rows[0];

        const isHashed = user.password.startsWith('$2b$') || user.password.startsWith('$2a$');
        let match = false;

        if (isHashed) {
            match = await bcrypt.compare(current_password, user.password);
        } else {
            if (user.password === current_password) match = true;
        }

        if (user && match) {
            const newHashedPassword = await bcrypt.hash(new_password, SALT_ROUNDS);
            await db.execute({ sql: "UPDATE users SET password = ? WHERE id = ?", args: [newHashedPassword, userId] });
            res.redirect('/settings?msg=password_changed');
        } else {
            res.redirect('/settings?error=invalid_password');
        }
    } catch (err) {
        console.error(err);
        res.redirect('/settings?error=error');
    }
});
// --- ADMIN ROUTES ---

// 1. GET: Admin Dashboard
// 1. GET: Admin Dashboard
router.get('/admin_dashboard', noCache, async (req, res) => {
    // Security: Strict check for Admin role
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.redirect('/login');
    }

    try {
        // A. Fetch All Users
        const { rows: users } = await db.execute({ sql: "SELECT * FROM users ORDER BY id DESC" });

        // B. Fetch Platform Stats
        const statsQuery = "SELECT COUNT(*) as total_orders, SUM(service_fee) as total_revenue FROM orders";
        const { rows: statsRes } = await db.execute({ sql: statsQuery });
        const stats = statsRes[0] || { total_orders: 0, total_revenue: 0 };

        res.render('admin_dashboard', {
            user: req.session.user,
            users: users,
            stats: stats,
            csrfToken: req.csrfToken ? req.csrfToken() : ''
        });
    } catch (err) {
        console.error(err);
        res.render('admin_dashboard', {
            user: req.session.user,
            users: [],
            stats: { total_orders: 0, total_revenue: 0 },
            csrfToken: req.csrfToken ? req.csrfToken() : ''
        });
    }
});

// 2. POST: Block/Unblock User
// 2. POST: Block/Unblock User
router.post('/admin/user/:id/toggle-block', async (req, res) => {
    // Security Check
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).send("Unauthorized");
    }

    const targetUserId = req.params.id;

    try {
        // First, check current status
        const { rows } = await db.execute({ sql: "SELECT is_blocked FROM users WHERE id = ?", args: [targetUserId] });
        const user = rows[0];

        if (!user) return res.redirect('/admin_dashboard');

        // Toggle logic
        const newStatus = user.is_blocked ? 0 : 1;

        await db.execute({ sql: "UPDATE users SET is_blocked = ? WHERE id = ?", args: [newStatus, targetUserId] });
        res.redirect('/admin_dashboard');
    } catch (err) {
        console.error("Error updating user status:", err);
        res.redirect('/admin_dashboard');
    }
});

// At the top of route.js (if not already there)
// --- CHECKOUT & PAYMENT ROUTES ---

// 1. GET: Show Checkout Page
// 1. GET: Show Checkout Page
router.get('/buy/:id', checkBan, async (req, res) => {
    // Security: Must be logged in
    if (!req.session.user) return res.redirect('/login');

    const productId = req.params.id;

    try {
        const { rows } = await db.execute({ sql: "SELECT * FROM products WHERE id = ?", args: [productId] });
        const product = rows[0];

        if (!product) {
            console.error("Product not found");
            return res.redirect('/');
        }

        // LOGIC: Calculate Service Fee (10%)
        // NEW MODEL: Buyer pays Price. Seller gets Price - 10%.
        const price = parseFloat(product.price);
        const serviceFee = Math.ceil(price * 0.10); // 10% Fee
        const total = price; // Buyer pays the listed price

        res.render('checkout', {
            user: req.session.user,
            product: product,
            serviceFee: serviceFee, // Passed to view, but maybe just for info?
            total: total,
            csrfToken: req.csrfToken ? req.csrfToken() : ''
        });
    } catch (err) {
        console.error(err);
        res.redirect('/');
    }
});

// 2. POST: Initialize Paystack Payment
// 2. POST: Initialize Paystack Payment
router.post('/paystack/initialize', checkBan, async (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const { productId, amount, serviceFee } = req.body;
    // sellerAmount is calculated securely here, not trusted from client
    const amountVal = parseFloat(amount);
    const feeVal = parseFloat(serviceFee);
    // Seller gets: Total Paid - Fee
    const sellerAmount = amountVal - feeVal;

    const user = req.session.user;
    const reference = 'ORD_' + Date.now() + '_' + user.id;

    const insertQuery = `
        INSERT INTO orders 
        (buyer_id, seller_id, product_id, amount, service_fee, seller_amount, status, payment_reference, buyer_confirmed, seller_confirmed, created_at) 
        VALUES (?, (SELECT seller_id FROM products WHERE id = ?), ?, ?, ?, ?, 'pending', ?, 0, 0, CURRENT_TIMESTAMP)
    `;

    try {
        await db.execute({
            sql: insertQuery,
            args: [user.id, productId, productId, amount, serviceFee, sellerAmount, reference]
        });

        const response = await axios.post(
            'https://api.paystack.co/transaction/initialize',
            {
                email: user.username + "@example.com",
                amount: Math.round(amount * 100),
                reference: reference,
                callback_url: "https://ui-ecommerce-production.up.railway.app/paystack/callback"
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        res.redirect(response.data.data.authorization_url);
    } catch (err) {
        console.error("Payment Init Error:", err);
        res.send("Payment initialization failed.");
    }
});

// // 3. GET: Paystack Verification (Handles BOTH Orders & Wallet Funding)
// 3. GET: Paystack Verification
router.get(['/paystack/verify', '/paystack/callback'], async (req, res) => {
    const reference = req.query.reference;
    if (!reference) return res.redirect('/');

    try {
        const verify = await axios.get(
            `https://api.paystack.co/transaction/verify/${reference}`,
            { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
        );

        if (verify.data.data.status === 'success') {
            const amountPaid = verify.data.data.amount / 100;
            const currentUser = req.session.user;

            // B. Check if this reference belongs to an existing ORDER
            const { rows } = await db.execute({ sql: "SELECT * FROM orders WHERE payment_reference = ?", args: [reference] });
            const order = rows[0];

            if (order) {
                // --- SCENARIO 1: IT IS A PRODUCT PURCHASE ---
                // 1. Credit Buyer's Wallet
                await db.execute({ sql: "UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?", args: [amountPaid, order.buyer_id] });

                // 2. Deduct Buyer's Wallet
                await db.execute({ sql: "UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?", args: [amountPaid, order.buyer_id] });

                // 3. Mark Order as Paid
                await db.execute({ sql: "UPDATE orders SET status = 'paid_pending_delivery' WHERE payment_reference = ?", args: [reference] });

                console.log(`Order #${order.id}: Funds routed through wallet for Buyer #${order.buyer_id}`);
                res.redirect('/buyer/dashboard');

            } else {
                // --- SCENARIO 2: IT IS WALLET FUNDING ---
                if (!currentUser) return res.redirect('/login');

                await db.execute({ sql: "UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?", args: [amountPaid, currentUser.id] });

                console.log(`Wallet funded: +₦${amountPaid} for User ${currentUser.id}`);
                res.redirect('/buyer/dashboard');
            }
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
// 2. POST: Initialize Ad Payment
router.post('/ads/paystack/initialize', checkBan, async (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const { message, plan } = req.body;
    const user = req.session.user;

    let durationDays = 1;
    let price = 500;
    if (plan === "3_day_1200") { durationDays = 3; price = 1200; }
    else if (plan === "7_day_2500") { durationDays = 7; price = 2500; }

    const reference = 'AD_' + Date.now() + '_' + user.id;

    const insertQuery = `
        INSERT INTO ads (seller_id, message, amount, category, status, payment_reference, expiry_date) 
        VALUES (?, ?, ?, ?, 'pending', ?, 0)
    `;

    try {
        await db.execute({
            sql: insertQuery,
            args: [user.id, message, price, durationDays.toString(), reference]
        });

        const response = await axios.post(
            'https://api.paystack.co/transaction/initialize',
            {
                email: user.username + "@example.com",
                amount: price * 100,
                reference: reference,
                callback_url: "https://ui-ecommerce-production.up.railway.app/ads/paystack/callback"
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        res.redirect(response.data.data.authorization_url);
    } catch (err) {
        console.error("Paystack Error:", err.response ? err.response.data : err.message);
        res.send("Payment initialization failed.");
    }
});

// 3. GET: Ad Payment Callback
// 3. GET: Ad Payment Callback
router.get('/ads/paystack/callback', async (req, res) => {
    const reference = req.query.reference;
    if (!reference) return res.redirect('/seller/dashboard');

    try {
        const verify = await axios.get(
            `https://api.paystack.co/transaction/verify/${reference}`,
            { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
        );

        if (verify.data.data.status === 'success') {
            const { rows } = await db.execute({ sql: "SELECT * FROM ads WHERE payment_reference = ?", args: [reference] });
            const ad = rows[0];

            if (!ad) return res.redirect('/seller/dashboard');

            const durationDays = parseInt(ad.category);
            const now = new Date();
            const expiryDate = new Date(now.setDate(now.getDate() + durationDays));
            const expiryTimestamp = Math.floor(expiryDate.getTime() / 1000);

            await db.execute({
                sql: "UPDATE ads SET status = 'active', expiry_date = ? WHERE payment_reference = ?",
                args: [expiryTimestamp, reference]
            });

            res.redirect('/seller/dashboard');

        } else {
            res.send("Ad payment verification failed.");
        }
    } catch (error) {
        console.error("Verification Error:", error);
        res.redirect('/seller/dashboard');
    }
});



module.exports = router;