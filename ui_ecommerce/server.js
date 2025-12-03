require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcrypt');
const axios = require('axios'); // Ensure axios is installed
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const csurf = require('csurf');
const { body, validationResult } = require('express-validator');
const { db, initDb } = require('./db');
const path = require('path');

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || 'sk_test_placeholder';

const app = express();
const PORT = process.env||3000;

// Initialize DB
initDb();

// Security Middleware
app.use(helmet());
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use(limiter);

// General Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static('public'));
app.set('view engine', 'ejs');

// Session
// Session Configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: false, // Set to true if using HTTPS (Render uses HTTPS automatically)
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// CSRF
const csrfProtection = csurf({ cookie: true });
app.use(csrfProtection);
app.use((req, res, next) => {
    res.locals.csrfToken = req.csrfToken();
    next();
});

// Blocked Check Middleware
const checkBlocked = (req, res, next) => {
    if (req.session.user) {
        db.get('SELECT is_blocked FROM users WHERE id = ?', [req.session.user.id], (err, user) => {
            if (err) return next(err);
            if (user && user.is_blocked) {
                req.session.destroy();
                return res.send("Your account has been blocked by the admin. Please contact support.");
            }
            next();
        });
    } else {
        next();
    }
};
app.use(checkBlocked);

// --- NEW HELPER FUNCTION ---
async function verifyPayment(reference) {
    try {
        const response = await axios.get(
            `https://api.paystack.co/transaction/verify/${reference}`,
            {
                headers: {
                    Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, // Using the constant defined at top
                },
            }
        );
        return response.data;
    } catch (error) {
        console.error("Paystack verification error:", error.response?.data || error.message);
        return null;
    }
}
// ---------------------------

// Routes

// Home
app.get('/', (req, res) => {
    db.all('SELECT * FROM products', (err, products) => {
        if (err) return res.send("Error loading products");
        const now = Date.now();
        db.all("SELECT * FROM ads WHERE status = 'active' AND expiry_date > ? ORDER BY id DESC LIMIT 3", [now], (err, ads) => {
             res.render('index', { user: req.session.user, products: products, ads: ads || [] });
        });
    });
});

// Admin Routes (Dashboard, Block, Unblock)
app.get('/admin/dashboard', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login');
    db.all('SELECT * FROM users WHERE role = "seller"', (err, sellers) => {
        db.all('SELECT * FROM users WHERE role = "buyer"', (err, buyers) => {
            res.render('admin_dashboard', { user: req.session.user, sellers: sellers, buyers: buyers });
        });
    });
});
app.post('/admin/block/:id', (req, res) => { /* ... existing block code ... */ }); // (Keep your existing code here)
app.post('/admin/unblock/:id', (req, res) => { /* ... existing unblock code ... */ }); // (Keep your existing code here)

// Seller Routes
app.get('/seller/dashboard', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'seller') return res.redirect('/login');
    db.all('SELECT * FROM products WHERE seller_id = ?', [req.session.user.id], (err, products) => {
        db.all('SELECT * FROM orders WHERE product_id IN (SELECT id FROM products WHERE seller_id = ?)', [req.session.user.id], (err, orders) => {
             res.render('seller_dashboard', { user: req.session.user, products: products, orders: orders });
        });
    });
});

app.post('/seller/add-product', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'seller') return res.status(403).send("Unauthorized");
    const { title, description, price } = req.body;
    db.run('INSERT INTO products (title, description, price, seller_id) VALUES (?, ?, ?, ?)', 
        [title, description, price, req.session.user.id], (err) => {
            if (err) console.error(err);
            res.redirect('/seller/dashboard');
        });
});

// Buyer Routes
app.get('/buyer/dashboard', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'buyer') return res.redirect('/login');
    const query = `SELECT orders.*, products.title as product_title FROM orders JOIN products ON orders.product_id = products.id WHERE orders.buyer_id = ?`;
    db.all(query, [req.session.user.id], (err, orders) => {
        if (err) return res.send("Error loading orders");
        res.render('buyer_dashboard', { user: req.session.user, orders: orders });
    });
});

app.get('/buy/:id', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    db.get('SELECT * FROM products WHERE id = ?', [req.params.id], (err, product) => {
        if (err || !product) return res.send("Product not found");
        const price = product.price;
        const serviceFee = price * 0.10;
        res.render('checkout', { user: req.session.user, product: product, serviceFee: serviceFee });
    });
});

// Seller Onboard
app.post('/seller/onboard', async (req, res) => {
    // ... (Keep your existing onboard code) ...
    // For brevity, assuming existing code is here
    if (!req.session.user || req.session.user.role !== 'seller') return res.status(403).send("Unauthorized");
    const { bank_name, account_number } = req.body;
    const mockSubaccountCode = 'ACCT_' + Math.floor(Math.random() * 1000000);
    db.run('UPDATE users SET bank_name = ?, account_number = ?, paystack_subaccount_code = ? WHERE id = ?', 
        [bank_name, account_number, mockSubaccountCode, req.session.user.id], (err) => {
            res.redirect('/seller/dashboard');
        });
});

// Paystack Initialize
app.post('/paystack/initialize', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const { productId } = req.body;

    db.get('SELECT * FROM products WHERE id = ?', [productId], async (err, product) => {
        if (err || !product) return res.send("Product not found");
        
        // In a real app, you would initialize the transaction with Paystack API here
        // and get an authorization URL. For this example, we redirect to our verify route.
        // Important: We still pass parameters for our logic, but verification happens via reference.
        
        const initReference = 'REF_' + Math.floor(Math.random() * 1000000000 + Date.now());
        const authUrl = `/paystack/verify?reference=${initReference}&productId=${product.id}`;
        
        // Note: In a real integration, you'd redirect to response.data.authorization_url
        res.redirect(authUrl);
    });
});

// --- UPDATED VERIFY ROUTE ---
app.get('/paystack/verify', async (req, res) => {
    const { reference, productId } = req.query;

    if (!reference) {
        return res.send("No payment reference provided.");
    }

    // Call the verification function
    const verification = await verifyPayment(reference);

    // Check if verification was successful
    if (verification && verification.status === true && verification.data.status === 'success') {
        
        // Payment is valid! 
        // Note: Paystack returns amount in kobo, so divide by 100
        const paidAmount = verification.data.amount / 100; 

        // Calculate Fees
        const serviceFee = paidAmount * 0.10;
        const sellerAmount = paidAmount - serviceFee;

        db.run('INSERT INTO orders (buyer_id, product_id, amount, service_fee, seller_amount, status, payment_reference, buyer_confirmed, seller_confirmed, escrow_released) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0)',
            [req.session.user.id, productId, paidAmount, serviceFee, sellerAmount, 'paid', reference], 
            (err) => {
                if (err) {
                    console.error(err);
                    return res.send("Error recording order.");
                }
                res.send(`Payment Verified & Successful! Funds held in Escrow.`);
            });
    } else {
        res.send("Payment verification failed. Please try again.");
    }
});
