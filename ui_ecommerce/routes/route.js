const express = require("express");
const router = express.Router();
const { db } = require('../db'); // Correctly import the database

// --- 1. HOME PAGE ---
router.get("/", (req, res) => {
    const user = req.session ? req.session.user : null;
    db.all("SELECT * FROM products", [], (err, products) => {
        if (err) products = [];
        db.all("SELECT * FROM ads", [], (err, ads) => {
            if (err) ads = [];
            res.render("index", { user: user, products: products, ads: ads });
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

module.exports = router;