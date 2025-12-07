require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const session = require("express-session");
// --- FIX 1: Import connect-mongo for session persistence ---
const axios = require("axios"); // Ensure axios is installed
//const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
const csurf = require("csurf");
const { body, validationResult } = require("express-validator");
const { db, initDb } = require("./db");
const path = require("path");
const mainRoutes = require("./routes/route");

var MongoDBStore = require("connect-mongodb-session")(session);

// --- FIX 2: Use environment variables for ALL secrets ---
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
// The MONGO_URI and Session Secret MUST come from your .env file in production.
const MONGO_URI = process.env.MONGO_URI;
const SESSION_SECRET = process.env.SESSION_SECRET;

const app = express();
app.set("trust proxy", 1); // Trust first proxy if behind a reverse proxys
const PORT = process.env.PORT || 3000;

// Initialize DB (Assuming this is a separate SQL database like SQLite)
initDb();

// Security Middleware

// Allow Paystack and inline scripts by disabling CSP
//app.use(helmet({ contentSecurityPolicy: false }));

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
app.use((req, res, next) => {
    res.setHeader(
        "Content-Security-Policy",
        "default-src 'self * 'unsafe-inline' 'unsafe-eval' data: blob:;"
    );
    next();
});
app.use((req, res, next) => {
    res.locals.user = req.session.user;
    next();
});

// CSRF is now handled in routes/route.js to support file uploads
// const csrfProtection = csurf({ cookie: true });
// app.use(csrfProtection);
// app.use((req, res, next) => {
//     res.locals.csrfToken = req.csrfToken();
//     next();
// });

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
app.use('/', mainRoutes);
// ... (Rest of the routes remain the same) ...
// Start Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
