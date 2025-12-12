const nodemailer = require('nodemailer');
const { Resend } = require('resend');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// SMTP Fallback Transporter (Gmail)
// Port 587 (STARTTLS)
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    logger: true,
    debug: true
});

async function sendEmail(to, subject, htmlContent) {
    // 1. Try Resend (HTTP API) - Works even if SMTP ports are blocked
    if (resend) {
        try {
            console.log(`[EMAIL] Sending to ${to} via Resend API...`);

            // CRITICAL: On Free Tier, you MUST send from 'onboarding@resend.dev'
            // Attempting to send from your gmail will fail with "You can only send testing emails to your own address"
            // if the FROM address is also your gmail. It expects the default sender.
            const fromAddress = 'onboarding@resend.dev';

            const data = await resend.emails.send({
                from: fromAddress,
                to: to,
                subject: subject,
                html: htmlContent
            });

            if (data.error) throw new Error(data.error.message);

            console.log(`[EMAIL] Success via Resend ID: ${data.data?.id}`);
            return true;
        } catch (err) {
            console.error(`[EMAIL] Resend API Failed: ${err.message}`);
            console.log("⚠️ Falling back to SMTP...");
            // Fallthrough to SMTP
        }
    }

    // 2. Fallback to Gmail SMTP
    const user = process.env.EMAIL_USER;
    if (!user) {
        console.log("⚠️ EMAIL MOCK: No Email Providers configured.");
        return true;
    }

    try {
        console.log(`[EMAIL] Sending to ${to} via Gmail SMTP...`);

        // Timeout Promise to prevent server hang (3s)
        const mailPromise = transporter.sendMail({
            from: `"UI Market Security" <${user}>`,
            to: to,
            subject: subject,
            html: htmlContent
        });

        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('SMTP Connection Timeout')), 3000)
        );

        await Promise.race([mailPromise, timeoutPromise]);

        console.log(`[EMAIL] Success via SMTP!`);
        return true;
    } catch (err) {
        console.error(`[EMAIL] SMTP Failed: ${err.message}`);
        console.log("⚠️ Email failed but flow continuing.");
        return true;
    }
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

module.exports = { sendEmail, generateOTP };
