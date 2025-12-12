const axios = require('axios');

async function sendEmail(to, subject, htmlContent) {
    const apiKey = process.env.SMTP_PASS || process.env.EMAIL_PASS;
    const senderEmail = process.env.EMAIL_FROM || process.env.SMTP_USER || process.env.EMAIL_USER;
    const senderName = "UI Market Security";

    if (!apiKey) {
        console.log("⚠️ EMAIL MOCK (API Key missing)");
        return true;
    }

    try {
        console.log(`[EMAIL] Sending via Brevo API (over HTTPS/443)...`);

        await axios.post(
            'https://api.brevo.com/v3/smtp/email',
            {
                sender: { name: senderName, email: senderEmail },
                to: [{ email: to }],
                subject: subject,
                htmlContent: htmlContent
            },
            {
                headers: {
                    'accept': 'application/json',
                    'api-key': apiKey,
                    'content-type': 'application/json'
                },
                timeout: 10000 // 10s timeout
            }
        );

        console.log(`[EMAIL] Success! Sent to ${to} via Brevo API.`);
        return true;
    } catch (err) {
        console.error("[EMAIL] API Failed:", err.response ? err.response.data : err.message);

        // Detailed error logging for debugging
        if (err.response && err.response.status === 401) {
            console.error("❌ Auth Error: Check if EMAIL_PASS is a valid Brevo API Key (not SMTP password).");
        }
        return false;
    }
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

module.exports = { sendEmail, generateOTP };
