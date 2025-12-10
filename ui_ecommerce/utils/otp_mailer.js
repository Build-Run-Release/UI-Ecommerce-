const nodemailer = require('nodemailer');
require('dotenv').config();

// Create transporter
// NOTE: For real production, use environment variables. 
// If variables are missing, we default to logging to console (for dev safety).
// Create transporter using Generic SMTP variables (compatible with Railway/Brevo)
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER || process.env.EMAIL_USER,
        pass: process.env.SMTP_PASS || process.env.EMAIL_PASS
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
        console.error("Error sending email:", err);
        return false;
    }
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

module.exports = { sendEmail, generateOTP };
