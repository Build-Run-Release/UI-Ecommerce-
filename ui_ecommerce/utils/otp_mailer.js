const nodemailer = require('nodemailer');
require('dotenv').config();

// Create transporter
// NOTE: For real production, use environment variables. 
// If variables are missing, we default to logging to console (for dev safety).
const port = parseInt(process.env.SMTP_PORT) || 587;
const secure = port === 465; // True for 465, false for other ports

// Helper to create transporter dynamically
function createTransporter(port, user, pass) {
    const isSecure = port === 465;
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
        port: port,
        secure: isSecure,
        auth: { user, pass },
        tls: { rejectUnauthorized: false },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000,
        debug: true,
        logger: true
    });
}

async function sendEmail(to, subject, htmlContent) {
    const user = process.env.SMTP_USER || process.env.EMAIL_USER;
    const pass = process.env.SMTP_PASS || process.env.EMAIL_PASS;
    const fromEmail = process.env.EMAIL_FROM || user;

    if (!user || !pass) {
        console.log("⚠️ EMAIL MOCK (Credentials missing)");
        return true;
    }

    // List of ports to try in order
    const ports = [
        parseInt(process.env.SMTP_PORT) || 587, // Default from env
        2525, // Common alternative
        465   // SSL port
    ];

    // Deduplicate ports
    const uniquePorts = [...new Set(ports)];

    for (const port of uniquePorts) {
        console.log(`[EMAIL] Attempting connection on Port ${port}...`);
        try {
            const transporter = createTransporter(port, user, pass);
            await transporter.verify(); // Check connection first
            await transporter.sendMail({
                from: `"UI Market Security" <${fromEmail}>`,
                to: to,
                subject: subject,
                html: htmlContent
            });
            console.log(`[EMAIL] Success! Sent to ${to} via Port ${port}`);
            return true;
        } catch (err) {
            console.error(`[EMAIL] Failed on Port ${port}:`, err.code || err.message);
            // Continue to next port
        }
    }

    console.error("ALL SMTP PORTS FAILED. Check Firewall/Credentials.");
    return false;
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

module.exports = { sendEmail, generateOTP };
