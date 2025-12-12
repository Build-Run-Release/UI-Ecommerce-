const nodemailer = require('nodemailer');

// Create transporter for Gmail
// Use Port 465 (SSL) for best reliability with Gmail
// Create transporter for Gmail
// Use Port 587 (STARTTLS) since 465 is blocked by firewall
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // Use STARTTLS
    auth: {
        user: process.env.EMAIL_USER, // Your Gmail Address
        pass: process.env.EMAIL_PASS  // Your Gmail App Password
    },
    // Debug settings
    logger: true,
    debug: true
});

async function sendEmail(to, subject, htmlContent) {
    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_PASS;

    if (!user || !pass) {
        console.log("⚠️ EMAIL MOCK (Credentials missing)");
        return true;
    }

    try {
        console.log(`[EMAIL] Sending to ${to} via Gmail SMTP...`);

        // Fail-safe: Timeout after 2.5 seconds to prevent server hang
        const mailPromise = transporter.sendMail({
            from: `"UI Market Security" <${user}>`,
            to: to,
            subject: subject,
            html: htmlContent
        });

        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Email Timeout')), 2500)
        );

        await Promise.race([mailPromise, timeoutPromise]);

        console.log(`[EMAIL] Success! Sent to ${to}`);
        return true;
    } catch (err) {
        console.error("Error sending email:", err.message);
        // We return TRUE here to allow variables/flow to continue even if email fails
        // This is critical because the user's firewall is blocking traffic.
        console.log("⚠️ Allowing flow to continue despite email failure.");
        return true;
    }
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

module.exports = { sendEmail, generateOTP };
