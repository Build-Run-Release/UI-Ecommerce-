const nodemailer = require('nodemailer');
require('dotenv').config();

// Create transporter
// NOTE: For real production, use environment variables. 
// If variables are missing, we default to logging to console (for dev safety).
const transporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.EMAIL_USER, // Brevo Login Email
        pass: process.env.EMAIL_PASS  // Brevo API Key / SMTP Master Password
    }
});

async function sendEmail(to, subject, htmlContent) {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
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
            from: `"UI Market Security" <${process.env.EMAIL_USER}>`,
            to: to,
            subject: subject,
            html: htmlContent
        });
        console.log(`[TESTING] Email sent to ${to}. Subject: ${subject}`);
        console.log(`[TESTING] Content (Peek): ${htmlContent}`);
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
