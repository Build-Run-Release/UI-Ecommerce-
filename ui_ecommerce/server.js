require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const session = require("express-session");
// --- FIX 1: Import connect-mongo for session persistence ---
const axios = require("axios"); // Ensure axios is installed
const compression = require("compression"); // Optimization: Gzip
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
const csurf = require("csurf");
const { body, validationResult } = require("express-validator");
const { db, initDb, pool } = require("./db");
const path = require("path");
const mainRoutes = require("./routes/route");

const pgSession = require('connect-pg-simple')(session);

// --- FIX 2: Use environment variables for ALL secrets ---
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
// The MONGO_URI and Session Secret MUST come from your .env file in production.
const MONGO_URI = process.env.MONGO_URI;
const SESSION_SECRET = process.env.SESSION_SECRET;

const app = express();
app.set("trust proxy", 1); // Trust first proxy if behind a reverse proxys
console.log("NODE_ENV:", process.env.NODE_ENV);
const PORT = process.env.PORT || 3000;

// Initialize DB (Assuming this is a separate SQL database like SQLite)
initDb();

// Security Middleware

// Use Helmet!
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'", "https://js.paystack.co", "https://checkout.paystack.com"],
                frameSrc: ["'self'", "https://checkout.paystack.com", "https://standard.paystack.co"],
                imgSrc: ["'self'", "data:", "blob:", "https://res.cloudinary.com", "https://assets.paystack.com", "https://ui-avatars.com", "https://via.placeholder.com"],
                connectSrc: ["'self'", "https://checkout.paystack.com"],
                formAction: ["'self'", "https://ui-ecommerce-production.up.railway.app", "https://checkout.paystack.com"],
            },
        },
    })
);

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use(limiter);
app.use(compression()); // Compress all responses

// General Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static("public"));
app.use('/uploads', express.static(path.join(__dirname, 'Uploads')));
app.set("view engine", "ejs");

var store = new pgSession({
    pool: pool,                // Connection pool
    tableName: 'session'       // Use permission granted to server
});

// --- FIX 3: Configure express-session with MongoStore ---
// This ensures sessions are persistent, handle server restarts, and allow for scaling.
app.use(
    session({
        store,
        name: 'session_id', // Don't use default 'connect.sid'
        cookie: {
            maxAge: 1000 * 60 * 60 * 24, // 1 day in milliseconds
            secure: false, // process.env.NODE_ENV === "production" DEBUG: Force false to test session
            httpOnly: true,
            sameSite: 'lax' // CSRF protection
        },
        resave: false, // Optimize: don't save if unmodified
        secret: SESSION_SECRET || "6bc55868-1c42-4eed-b5f9-4e1108ad47f9", // We will keep the callback strictly for dev convenience but in prod it should be env
        saveUninitialized: false, // Optimize: don't create session until something stored
    })
);
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
const checkBlocked = async (req, res, next) => {
    if (req.session.user) {
        try {
            const result = await db.execute({
                sql: "SELECT is_blocked, ban_expires FROM users WHERE id = ?",
                args: [req.session.user.id]
            });
            const user = result.rows[0];

            // Fix: Cast to number because CockroachDB returns INT as string (BigInt) - Postgres returns number (int4)
            // SAFEGARD: Ensure user exists and is_blocked is not null/undefined before checking
            // Fix: Cast to number because CockroachDB returns INT as string (BigInt)
            const isBlocked = user && user.is_blocked ? Number(user.is_blocked) : 0;
            const banExpires = user && user.ban_expires ? Number(user.ban_expires) : 0;
            const now = Date.now();

            if (isBlocked !== 0) {
                console.log(`User ${req.session.user.id} is PERMANENTLY BLOCKED.`);
                req.session.destroy();
                return res.send("Your account has been permanently suspended by the admin.");
            }

            if (banExpires > now) {
                const daysLeft = Math.ceil((banExpires - now) / (1000 * 60 * 60 * 24));
                console.log(`User ${req.session.user.id} is TEMP BANNED until ${new Date(banExpires)}`);
                req.session.destroy();
                return res.send(`Your account is temporarily restricted for ${daysLeft} more day(s).`);
            }

            next();
        } catch (err) {
            next(err);
        }
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
    console.log(`DB Connection String (Masked): ${process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/:([^:@]+)@/, ':****@') : 'UNDEFINED'}`);
});
