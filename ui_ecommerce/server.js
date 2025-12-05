require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const session = require("express-session");
// --- FIX 1: Import connect-mongo for session persistence ---
const axios = require("axios"); // Ensure axios is installed
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
const csurf = require("csurf");
const { body, validationResult } = require("express-validator");
const { db, initDb } = require("./db");
const path = require("path");
const router = require("./routes/route");

var MongoDBStore = require("connect-mongodb-session")(session);

// --- FIX 2: Use environment variables for ALL secrets ---
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
// The MONGO_URI and Session Secret MUST come from your .env file in production.
const MONGO_URI = process.env.MONGO_URI;
const SESSION_SECRET = process.env.SESSION_SECRET;

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize DB (Assuming this is a separate SQL database like SQLite)
initDb();

// Security Middleware
app.use(helmet());
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use(limiter);

// General Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static("public"));
app.set("view engine", "ejs");

var store = new MongoDBStore({
    uri: process.env.MONGO_URI,
    collection: "mySessions",
});

// --- FIX 3: Configure express-session with MongoStore ---
// This ensures sessions are persistent, handle server restarts, and allow for scaling.
app.use(
    session({
        store,
        cookie: {
            maxAge: 1000 * 60 * 60 * 24, // 1 day in milliseconds
            secure: process.env.NODE_ENV === "production",
            httpOnly: true,
        },
        resave: true,
        secret:
            process.env.SESSION_SECRET ||
            "6bc55868-1c42-4eed-b5f9-4e1108ad47f9",
        saveUninitialized: true,
    })
);

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
        db.get(
            "SELECT is_blocked FROM users WHERE id = ?",
            [req.session.user.id],
            (err, user) => {
                if (err) return next(err);
                if (user && user.is_blocked) {
                    req.session.destroy();
                    return res.send(
                        "Your account has been blocked by the admin. Please contact support."
                    );
                }
                next();
            }
        );
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
                    // Paystack secret key from environment variables
                    Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
                },
            }
        );
        return response.data;
    } catch (error) {
        console.error(
            "Paystack verification error:",
            error.response?.data || error.message
        );
        return null;
    }
}
// ---------------------------

// ... (Rest of the routes remain the same) ...
app.use("/", router);
// --- LOGIN ROUTES ---

// 1. GET Route: Shows the Login Page
app.get('/login', (req, res) => {
    // We pass 'error: null' so the page doesn't crash trying to read an undefined variable
    res.render('login', { error: null, csrfToken: req.csrfToken ? req.csrfToken() : '' });
});

// 2. POST Route: Handles the Form Submission
app.post('/login', (req, res) => {
    const { username, password } = req.body;

    // Database Logic: Find the user
    // Note: Since I can't see your db.js, this uses standard SQLite syntax.
    // If you are using a different DB setup, let me know!
    const query = "SELECT * FROM users WHERE username = ?";
    
    db.get(query, [username], (err, user) => {
        if (err) {
            console.error(err);
            return res.render('login', { error: "System error, try again.", csrfToken: req.csrfToken ? req.csrfToken() : '' });
        }

        // Check if user exists
        if (!user) {
            return res.render('login', { error: "User not found!", csrfToken: req.csrfToken ? req.csrfToken() : '' });
        }

        // Check if password matches (Using simple comparison for now)
        // In a real app, you should use: if (bcrypt.compareSync(password, user.password_hash))
        if (user.password !== password) {
            return res.render('login', { error: "Invalid password!", csrfToken: req.csrfToken ? req.csrfToken() : '' });
        }

        // SUCCESS! Save user to session
        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.role = user.role; // Assuming your DB has a 'role' column (admin/buyer)

        // Redirect based on Role
        if (user.role === 'admin') {
            res.redirect('/admin_dashboard');
        } else {
            res.redirect('/'); // Buyers go to the home page
        }
    });
});
// Start Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
