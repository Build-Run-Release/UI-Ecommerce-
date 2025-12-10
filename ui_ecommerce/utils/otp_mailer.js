const nodemailer = require('nodemailer');
require('dotenv').config();

// Create transporter
// NOTE: For real production, use environment variables. 
// If variables are missing, we default to logging to console (for dev safety).
const port = parseInt(process.env.SMTP_PORT) || 587;
const secure = port === 465; // True for 465, false for other ports

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
    port: port,
    secure: secure,
    auth: {
        user: process.env.SMTP_USER || process.env.EMAIL_USER,
        pass: process.env.SMTP_PASS || process.env.EMAIL_PASS
    },
    // Improvements for Timeout Issues
    connectionTimeout: 20000, // 20 seconds
    greetingTimeout: 20000,
    socketTimeout: 20000,
    dnsTimeout: 20000,
    logger: true, // Log to console
    debug: true,  // Include SMTP traffic in logs
    // Force IPv4 to avoid IPv6 timeouts
    family: 4,
    tls: {
        rejectUnauthorized: false // Helps if certificate issues usually
    }
});

async function sendEmail(to, subject, htmlContent) {
    const user = process.env.SMTP_USER || process.env.EMAIL_USER;
    const pass = process.env.SMTP_PASS || process.env.EMAIL_PASS;
    const fromEmail = process.env.EMAIL_FROM || user;

    if (!user || !pass) {
        console.log("==========================================");
        console.log("⚠️ EMAIL MOCK (Credentials missing in .env)");
        console.log(`To: ${to}`);
        console.log(`Subject: ${subject}`);
        console.log(`Content: ${htmlContent}`);
        console.log("==========================================");
        return true;
    }

    try {
        await transporter.sendMail({
            from: `"UI Market Security" <${fromEmail}>`,
            to: to,
            subject: subject,
            html: htmlContent
        });
        console.log(`[EMAIL] Sent to ${to} via ${process.env.SMTP_HOST || 'default'}`);
        return true;
    } catch (err) {
        console.error("Error sending email (Attempt 1):", err.code || err);

        // RETRY LOGIC for Port 465/587 Timeout -> Try Port 2525
        if (err.code === 'ETIMEDOUT' || err.code === 'ESOCKET') {
            console.log("⚠️ Timeout detected. Retrying with Port 2525 (Brevo Alternative)...");

            const backupTransporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
                port: 2525, // Fallback port often used to bypass blocks
                secure: false,
                auth: { user: user, pass: pass },
                tls: { rejectUnauthorized: false },
                connectionTimeout: 20000,
                debug: true
            });

            try {
                await backupTransporter.sendMail({
                    from: `"UI Market Security" <${fromEmail}>`,
                    to: to,
                    subject: subject,
                    html: htmlContent
                });
                console.log(`[EMAIL] Sent to ${to} via Port 2525 (Fallback Success)`);
                return true;
            } catch (retryErr) {
                console.error("Error sending email (Fallback Failed):", retryErr);
                return false;
            }
        }

        return false;
    }
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

module.exports = { sendEmail, generateOTP };
