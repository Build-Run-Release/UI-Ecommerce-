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
const { checkProductPricing, checkSpamming, flagUser, checkDescriptionContent, checkBankDetails, checkAccountVelocity } = require('../utils/fraud_engine');
const { sendEmail } = require('../utils/otp_mailer');

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

// --- HELPER: Fetch Categories ---
// --- HELPER: Fetch Categories (With Caching) ---
let categoriesCache = null;
let lastCacheTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

async function getCategories() {
    const now = Date.now();
    if (categoriesCache && (now - lastCacheTime < CACHE_DURATION)) {
        return categoriesCache;
    }

    try {
        const { rows } = await db.execute({ sql: "SELECT name FROM categories ORDER BY name ASC" });
        categoriesCache = rows.map(r => r.name);
        lastCacheTime = now;
        return categoriesCache;
    } catch (err) {
        console.error("Error fetching categories:", err);
        return [];
    }
}

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
        // --- FRAUD CHECK: SPAM ---
        if (await checkSpamming(req.session.user)) {
            return res.status(429).send("You are posting too fast. Account flagged.");
        }

        // --- FRAUD CHECK: VELOCITY (New Accounts) ---
        if (await checkAccountVelocity(req.session.user)) {
            return res.status(429).send("New account limit: Max 3 items in 24h. Account flagged.");
        }

        // --- FRAUD CHECK: CONTENT (Keywords) ---
        if (await checkDescriptionContent(req.session.user, title, description)) {
            return res.status(400).send("Policy Violation: Restricted keywords detected. Account flagged.");
        }

        // --- PRICE GUARD IMPLEMENTATION ---
        const { rows: marketPrices } = await db.execute({ sql: "SELECT * FROM market_prices" });
        // Simple fuzzy match: check if product title contains the market item name
        const match = marketPrices.find(p => title.toLowerCase().includes(p.item_name.toLowerCase()));

        if (match) {
            // Rule: Price cannot be more than 20% above max, or less than 50% of min (suspicious)
            // Use Fraud Engine Helper
            const isFraud = await checkProductPricing(req.session.user, submittedPrice, match);
            if (isFraud) {
                return res.status(400).send("Price Guard: Your price is suspiciously low compared to market value. Action flagged.");
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

const { sendEmail, generateOTP } = require('../utils/otp_mailer');
const svgCaptcha = require('svg-captcha');

// --- CAPTCHA ROUTE ---
router.get('/captcha', (req, res) => {
    const captcha = svgCaptcha.create({
        size: 5,
        noise: 2,
        color: true,
        background: '#f0f0f0'
    });
    // Store in session
    req.session.captcha = captcha.text;

    res.type('svg');
    res.status(200).send(captcha.data);
});

// --- APPLY GLOBAL CSRF TO ALL OTHER ROUTES ---
router.use(csrfProtection);
router.use(passCsrfToken);

// --- TERMS & CONDITIONS ROUTE ---
router.get('/terms', (req, res) => {
    res.render('terms', { user: req.session.user });
});

// --- FEEDBACK ROUTES ---
router.get('/feedback', (req, res) => {
    res.render('feedback', {
        user: req.session.user,
        msg: req.query.msg,
        csrfToken: req.csrfToken ? req.csrfToken() : ''
    });
});

router.post('/feedback', async (req, res) => {
    const { name, email, message_type, message } = req.body;
    const userId = req.session.user ? req.session.user.id : null;

    try {
        await db.execute({
            sql: "INSERT INTO feedback (user_id, name, email, message_type, message) VALUES (?, ?, ?, ?, ?)",
            args: [userId, name, email, message_type, message]
        });

        // If it's a complaint against a specific user (heuristic: message contains "user"), maybe flag?
        // For now, simplify.

        res.render('feedback', {
            user: req.session.user,
            msg: "Thank you! Your feedback has been received.",
            csrfToken: req.csrfToken ? req.csrfToken() : ''
        });
    } catch (err) {
        console.error("Feedback Error:", err);
        res.render('feedback', {
            user: req.session.user,
            msg: "Error submitting feedback.",
            csrfToken: req.csrfToken ? req.csrfToken() : ''
        });
    }
});

// ------------------------------------------------

// --- 1. HOME PAGE ROUTE (Now with Search!) ---
router.get("/", async (req, res) => {
    const user = req.session ? req.session.user : null;
    const searchTerm = req.query.search || ""; // Get what they typed (or empty)

    // A. Build the Product Query
    // FIX: Filter out banned sellers (Permanent or Temporary)
    const currentTime = Date.now();
    let productQuery = `
        SELECT p.* FROM products p 
        JOIN users u ON p.seller_id = u.id 
        WHERE (u.is_blocked = 0 OR u.is_blocked IS NULL) 
        AND (u.ban_expires IS NULL OR u.ban_expires < ?)
    `;
    let params = [currentTime];

    // Fetch Categories for Sidebar
    const categories = await getCategories();

    // If they searched, filter by Title OR Description
    if (searchTerm) {
        productQuery += " AND (p.title ILIKE ? OR p.description ILIKE ?)";
        params.push(`%${searchTerm}%`, `%${searchTerm}%`);
    }

    // Filter by Category
    const category = req.query.category;
    if (category) {
        if (params.length > 0) {
            productQuery += " AND category = ?";
        } else {
            productQuery += " AND category = ?";
        }
        params.push(category);
    }

    // Filter by Price Range
    const minPrice = req.query.min_price;
    const maxPrice = req.query.max_price;

    if (minPrice) {
        if (params.length > 0 || productQuery.includes("WHERE")) {
            productQuery += " AND price >= ?";
        } else {
            productQuery += " AND p.price >= ?";
        }
        params.push(minPrice);
    }

    if (maxPrice) {
        if (params.length > 0 || productQuery.includes("WHERE")) {
            productQuery += " AND price <= ?";
        } else {
            productQuery += " AND p.price <= ?";
        }
        params.push(maxPrice);
    }

    // Order by newest first
    productQuery += " ORDER BY p.id DESC";

    try {
        // OPTIMIZATION: Run independent queries in parallel
        const [productsRes, adsRes] = await Promise.all([
            db.execute({ sql: productQuery, args: params }),
            db.execute({ sql: "SELECT * FROM ads WHERE status = 'active'" })
        ]);

        const products = productsRes.rows;
        const ads = adsRes.rows;

        res.render("index", {
            user: user,
            products: products,
            ads: ads,
            searchTerm: searchTerm,
            currentCategory: category,
            minPrice: minPrice,
            maxPrice: maxPrice,
            categories: categories,
            csrfToken: req.csrfToken ? req.csrfToken() : ''
        });
    } catch (err) {
        console.error(err);
        res.render("index", {
            user: user,
            products: [],
            ads: [],
            searchTerm: searchTerm,
            currentCategory: req.query.category || '',
            categories: []
        });
    }
});

// --- 2. AUTHENTICATION (Login/Signup/Logout) ---
router.get("/signup", (req, res) => res.render("signup", { error: null, csrfToken: req.csrfToken ? req.csrfToken() : '' }));

router.post("/signup", async (req, res) => {
    const { username, password, role, email, terms } = req.body;
    console.log(`Signup attempt: ${username}, role: ${role}`);

    if (terms !== 'on') {
        return res.render('signup', { error: "You must agree to the Terms & Conditions.", csrfToken: req.csrfToken() });
    }

    try {
        const check = await db.execute({ sql: "SELECT * FROM users WHERE username = ? OR email = ?", args: [username, email] });
        if (check.rows.length > 0) return res.render('signup', { error: "Username or Email already taken!", csrfToken: req.csrfToken() });

        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        await db.execute({
            sql: "INSERT INTO users (username, password, role, email) VALUES (?, ?, ?, ?)",
            args: [username, hashedPassword, role, email]
        });

        // Auto Login logic -> NOW REDIRECT TO LOGIN (Security Best Practice: Force them to login/verify)
        res.redirect('/login');

    } catch (err) {
        console.error("Signup Error:", err);
        return res.render('signup', { error: "Error creating user", csrfToken: req.csrfToken() });
    }
});

router.get("/login", (req, res) => res.render("login", { error: null, csrfToken: req.csrfToken ? req.csrfToken() : '' }));

// LOGIN with OTP Support
router.post("/login", async (req, res) => {
    const { username, password } = req.body;
    try {
        const { rows } = await db.execute({ sql: "SELECT * FROM users WHERE username = ?", args: [username] });
        const user = rows[0];

        if (!user) return res.render('login', { error: "Invalid credentials", csrfToken: req.csrfToken() });

        // --- PASSWORD CHECK ---
        const isHashed = user.password.startsWith('$2b$') || user.password.startsWith('$2a$');
        let match = false;
        if (isHashed) {
            match = await bcrypt.compare(password, user.password);
        } else {
            if (user.password === password) {
                match = true;
                // Lazy Migration
                const newHash = await bcrypt.hash(password, SALT_ROUNDS);
                await db.execute({ sql: "UPDATE users SET password = ? WHERE id = ?", args: [newHash, user.id] });
            }
        }

        if (!match) {
            return res.render('login', { error: "Invalid credentials", csrfToken: req.csrfToken() });
        }

        // --- CONDITIONAL OTP LOGIC ---
        // 1. High Risk Check (Flagged or High Suspicion)
        const isHighRisk = user.is_flagged || (user.suspicion_score && user.suspicion_score > 50);

        // 2. Random Security Check (20% chance if not high risk)
        const isRandomCheck = Math.random() < 0.2;

        // DISABLE OTP: Force direct login for now
        if (false && (isHighRisk || isRandomCheck)) {
            // GENERATE OTP
            const otp = generateOTP();
            const otpHash = await bcrypt.hash(otp, 10);
            const otpExpires = Date.now() + 10 * 60 * 1000; // 10 mins

            await db.execute({
                sql: "UPDATE users SET otp_hash = ?, otp_expires = ? WHERE id = ?",
                args: [otpHash, otpExpires, user.id]
            });

            // Send Email (SendPulse API)
            const { sendEmail } = require('../utils/otp_mailer');

            // Log for Dev/Debug (remove in strict prod if needed, but useful now)
            console.log(`[LOGIN OTP DEBUG] User: ${user.email} | Code: ${otp}`);

            await sendEmail(user.email, "Login Verification Code", `<h3>Your Login Code: ${otp}</h3><p>Valid for 10 minutes.</p>`);

            console.log(`[AUTH] OTP Triggered for user ${user.id}. Risk: ${isHighRisk}, Random: ${isRandomCheck}`);

            // Store user ID temporarily in session
            req.session.temp_login_id = user.id;
            return res.redirect('/verify-otp');
        } else {
            // SKIP OTP - DIRECT LOGIN
            req.session.user = { id: user.id, username: user.username, role: user.role, email: user.email };
            console.log(`[AUTH] User ${user.id} logged in directly (Skipped OTP).`);
            return res.redirect('/');
        }
    } catch (err) {
        console.error(err);
        res.render('login', { error: "Login failed", csrfToken: req.csrfToken() });
    }
});

// --- VERIFY OTP ROUTES ---
router.get("/verify-otp", (req, res) => {
    if (!req.session.temp_login_id) return res.redirect('/login');
    res.render('verify-otp', { error: null });
});

router.post("/verify-otp", async (req, res) => {
    if (!req.session.temp_login_id) return res.redirect('/login');
    const { otp } = req.body;

    try {
        const { rows } = await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [req.session.temp_login_id] });
        const user = rows[0];

        if (!user || !user.otp_hash || !user.otp_expires) {
            return res.render('verify-otp', { error: "Invalid request. Login again." });
        }

        if (Date.now() > user.otp_expires) {
            return res.render('verify-otp', { error: "Code expired. Login again." });
        }

        const match = await bcrypt.compare(otp, user.otp_hash);
        if (!match) {
            return res.render('verify-otp', { error: "Invalid code." });
        }

        // --- OTP SUCCESS: LOG IN USER ---
        req.session.user = user;
        delete req.session.temp_login_id; // Clear temp

        // Clear OTP from DB
        await db.execute({ sql: "UPDATE users SET otp_hash = NULL, otp_expires = NULL WHERE id = ?", args: [user.id] });

        if (user.role === 'admin') res.redirect('/admin_dashboard');
        else if (user.role === 'seller') res.redirect('/seller/dashboard');
        else res.redirect('/');

    } catch (err) {
        console.error(err);
        res.render('verify-otp', { error: "Verification failed." });
    }
});

router.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

// --- 3. SELLER DASHBOARD ---
router.get('/seller/dashboard', noCache, checkBan, csrfProtection, async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'seller') return res.redirect('/login');
    const sellerId = req.session.user.id;
    try {
        const { rows: products } = await db.execute({ sql: "SELECT * FROM products WHERE seller_id = ?", args: [sellerId] });
        const { rows: orders } = await db.execute({ sql: "SELECT * FROM orders WHERE seller_id = ?", args: [sellerId] });
        const { rows: users } = await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [sellerId] });
        const user = users[0];

        const categories = await getCategories();

        res.render('seller_dashboard', { user: user || req.session.user, products: products, orders: orders, categories: categories, csrfToken: req.csrfToken ? req.csrfToken() : '' });
    } catch (err) {
        console.error(err);
        res.render('seller_dashboard', { user: req.session.user, products: [], orders: [], categories: [], csrfToken: req.csrfToken ? req.csrfToken() : '' });
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

    // --- FRAUD CHECK: BANK COLLISION ---
    if (await checkBankDetails(req.session.user, account_number)) {
        // Silently fail or alert? Let's alert.
        return res.send("Error: This bank account is already associated with another user. Action flagged.");
    }

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
router.get('/buyer/dashboard', noCache, checkBan, csrfProtection, async (req, res) => {
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

// 3. POST: Seller Confirms DELIVERY (Starts 24h Timer or Instant Code)
router.post('/order/:id/confirm/seller-code', checkBan, async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const orderId = req.params.id;
    const { delivery_code } = req.body;
    const sellerId = req.session.user.id;

    try {
        const { rows } = await db.execute({ sql: "SELECT * FROM orders WHERE id = ? AND seller_id = ?", args: [orderId, sellerId] });
        const order = rows[0];

        if (!order) return res.redirect('/seller/dashboard?error=not_found');
        if (order.status === 'completed') return res.redirect('/seller/dashboard?msg=already_completed');

        // Check Code
        if (order.delivery_code === delivery_code) {
            // SUCCESS: Release Funds Instant
            await db.execute({
                sql: "UPDATE orders SET status = 'completed', seller_confirmed = 1, escrow_released = 1, code_confirmed_at = CURRENT_TIMESTAMP WHERE id = ?",
                args: [orderId]
            });

            await db.execute({ sql: "UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?", args: [order.seller_amount, sellerId] });

            return res.redirect('/seller/dashboard?msg=funds_released');
        } else {
            return res.redirect('/seller/dashboard?error=invalid_code');
        }
    } catch (err) {
        console.error(err);
        res.redirect('/seller/dashboard');
    }
});

router.post('/order/:id/confirm/seller-delivered', checkBan, async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const orderId = req.params.id;

    // Mark as delivered -> Starts 24h clock
    try {
        await db.execute({
            sql: "UPDATE orders SET seller_confirmed = 1, status = 'shipped', delivered_at = CURRENT_TIMESTAMP WHERE id = ? AND seller_id = ?",
            args: [orderId, req.session.user.id]
        });
        res.redirect('/seller/dashboard?msg=timer_started');
    } catch (err) {
        console.error(err);
        res.redirect('/seller/dashboard');
    }
});

router.post('/order/:id/claim-funds', checkBan, async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const orderId = req.params.id;
    const sellerId = req.session.user.id;

    try {
        const { rows } = await db.execute({ sql: "SELECT * FROM orders WHERE id = ? AND seller_id = ?", args: [orderId, sellerId] });
        const order = rows[0];

        if (!order || order.status === 'completed') return res.redirect('/seller/dashboard');
        if (order.disputed === 1) return res.redirect('/seller/dashboard?error=disputed');

        if (!order.delivered_at) return res.redirect('/seller/dashboard?error=not_delivered_yet');

        // Check 24 Hours
        const deliveredTime = new Date(order.delivered_at).getTime();
        const now = Date.now();
        const hoursDiff = (now - deliveredTime) / (1000 * 60 * 60);

        if (hoursDiff >= 24) {
            // Release Funds
            await db.execute({
                sql: "UPDATE orders SET status = 'completed', escrow_released = 1 WHERE id = ?",
                args: [orderId]
            });
            await db.execute({ sql: "UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?", args: [order.seller_amount, sellerId] });
            return res.redirect('/seller/dashboard?msg=funds_claimed');
        } else {
            return res.redirect('/seller/dashboard?error=wait_24h');
        }
    } catch (err) {
        console.error(err);
        res.redirect('/seller/dashboard');
    }
});

router.post('/order/:id/dispute', checkBan, async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const orderId = req.params.id;
    try {
        await db.execute({ sql: "UPDATE orders SET disputed = 1 WHERE id = ?", args: [orderId] });
        res.redirect('back');
    } catch (err) {
        console.error(err);
        res.redirect('back');
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

    const { current_password, new_password, captcha } = req.body;
    const userId = req.session.user.id;

    // CAPTCHA VERIFICATION
    if (!req.session.captcha || req.session.captcha !== captcha) {
        return res.redirect('/settings?error=invalid_captcha'); // You'll need to handle this in UI
    }

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

        // A2. Fetch Flagged Users (High Suspicion)
        const { rows: flaggedUsers } = await db.execute({ sql: "SELECT * FROM users WHERE is_flagged = 1 OR suspicion_score > 50 ORDER BY suspicion_score DESC" });

        // A3. Fetch User Feedback
        const { rows: feedback } = await db.execute({ sql: "SELECT * FROM feedback ORDER BY created_at DESC" });

        // B. Fetch Platform Stats
        const statsQuery = "SELECT COUNT(*) as total_orders, SUM(service_fee) as total_revenue FROM orders";
        const { rows: statsRes } = await db.execute({ sql: statsQuery });
        const stats = statsRes[0] || { total_orders: 0, total_revenue: 0 };

        res.render('admin_dashboard', {
            user: req.session.user,
            users: users,
            flaggedUsers: flaggedUsers,
            feedback: feedback, // Pass feedback to view
            stats: stats,
            csrfToken: req.csrfToken ? req.csrfToken() : ''
        });
    } catch (err) {
        console.error(err);
        res.render('admin_dashboard', {
            user: req.session.user,
            users: [],
            flaggedUsers: [],
            stats: { total_orders: 0, total_revenue: 0 },
            csrfToken: req.csrfToken ? req.csrfToken() : ''
        });
    }
});

// 2. POST: Block/Unblock User
// 2. POST: Block/Unblock User
router.post('/admin/user/:id/ban', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).send("Unauthorized");

    const targetUserId = req.params.id;
    const { type, days } = req.body;

    try {
        if (type === 'temporary' && days) {
            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + parseInt(days));
            await db.execute({
                sql: "UPDATE users SET is_blocked = 0, ban_expires = ? WHERE id = ?",
                args: [expiryDate.getTime(), targetUserId]
            });
        } else {
            // Permanent
            await db.execute({ sql: "UPDATE users SET is_blocked = 1, ban_expires = NULL WHERE id = ?", args: [targetUserId] });
        }
        res.redirect('/admin_dashboard');
    } catch (err) {
        console.error("Error banning user:", err);
        res.redirect('/admin_dashboard');
    }
});

router.post('/admin/user/:id/unban', async (req, res) => {
    // Security Check
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).send("Unauthorized");
    }

    const targetUserId = req.params.id;

    try {
        await db.execute({ sql: "UPDATE users SET is_blocked = 0, ban_expires = NULL WHERE id = ?", args: [targetUserId] });
        res.redirect('/admin_dashboard');
    } catch (err) {
        console.error("Error unbanning user:", err);
        res.redirect('/admin_dashboard');
    }
});

router.post('/admin/user/:id/delete', async (req, res) => {
    // Security Check
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).send("Unauthorized");
    }

    const targetUserId = req.params.id;

    try {
        // PERMANENT DELETE
        // Note: In a real app, you might want to soft delete or handle related data (orders/products).
        // Assuming cascade or simple delete for this context.
        await db.execute({ sql: "DELETE FROM users WHERE id = ?", args: [targetUserId] });
        res.redirect('/admin_dashboard');
    } catch (err) {
        console.error("Error deleting user:", err);
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

    // --- SELLER PROTECTION: GENERATE DELIVERY CODE ---
    const deliveryCode = Math.floor(100000 + Math.random() * 900000).toString();

    const insertQuery = `
        INSERT INTO orders 
        (buyer_id, seller_id, product_id, amount, service_fee, seller_amount, status, payment_reference, buyer_confirmed, seller_confirmed, created_at, delivery_code) 
        VALUES (?, (SELECT seller_id FROM products WHERE id = ?), ?, ?, ?, ?, 'pending', ?, 0, 0, CURRENT_TIMESTAMP, ?)
    `;

    try {
        await db.execute({
            sql: insertQuery,
            args: [user.id, productId, productId, amount, serviceFee, sellerAmount, reference, deliveryCode]
        });

        const response = await axios.post(
            'https://api.paystack.co/transaction/initialize',
            {
                email: user.email,
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
                email: user.email,
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




// --- FEEDBACK ROUTE ---
router.get('/feedback', csrfProtection, (req, res) => {
    res.render('feedback', {
        user: req.session.user,
        csrfToken: req.csrfToken(),
        msg: req.query.msg
    });
});

router.post('/feedback', csrfProtection, async (req, res) => {
    const { name, email, message_type, message } = req.body;

    // Construct Email
    const subject = `[Feedback] ${message_type} from ${name}`;
    const htmlBody = `
        <h3>New Feedback Submission</h3>
        <p><strong>From:</strong> ${name} (${email})</p>
        <p><strong>Topic:</strong> ${message_type}</p>
        <hr/>
        <p><strong>Message:</strong></p>
        <blockquote style="background: #f9f9f9; padding: 10px; border-left: 5px solid #ccc;">
            ${message.replace(/\n/g, '<br>')}
        </blockquote>
    `;

    try {
        // Send to Admin
        await sendEmail('Bomane.ar@gmail.com', subject, htmlBody);
        res.render('feedback', {
            user: req.session.user,
            csrfToken: req.csrfToken(),
            msg: "Message sent! We'll get back to you soon."
        });
    } catch (err) {
        console.error("Feedback Email Error:", err);
        res.render('feedback', {
            user: req.session.user,
            csrfToken: req.csrfToken(),
            msg: "Error sending message. Please try again later."
        });
    }
});

module.exports = router;