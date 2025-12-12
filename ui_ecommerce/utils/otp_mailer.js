const axios = require('axios');
const nodemailer = require('nodemailer');

// --- SENDPULSE CONFIG ---
const SP_ID = process.env.SENDPULSE_CLIENT_ID;
const SP_SECRET = process.env.SENDPULSE_CLIENT_SECRET;
const TOKEN_URL = 'https://api.sendpulse.com/oauth/access_token';
const SEND_URL = 'https://api.sendpulse.com/smtp/emails';

// Simple in-memory token cache
let cachedToken = null;
let tokenExpiry = 0;

async function getSendPulseToken() {
    // Return cached token if valid (buffer 5 mins)
    if (cachedToken && Date.now() < tokenExpiry - 300000) {
        return cachedToken;
    }

    try {
        console.log("[EMAIL] Fetching new SendPulse Access Token...");
        const response = await axios.post(TOKEN_URL, {
            grant_type: 'client_credentials',
            client_id: SP_ID,
            client_secret: SP_SECRET
        });

        cachedToken = response.data.access_token;
        // Expires in defaults to 3600s usually (1 hour)
        tokenExpiry = Date.now() + (response.data.expires_in * 1000);
        return cachedToken;
    } catch (err) {
        console.error("[EMAIL] Auth Failed:", err.response?.data || err.message);
        throw new Error("SendPulse Auth Failed");
    }
}

async function sendEmail(to, subject, htmlContent) {
    // 1. Validate Credentials
    if (!SP_ID || !SP_SECRET) {
        console.error("[EMAIL] Missing SendPulse Credentials in .env");
        return fallbackSMTP(to, subject, htmlContent);
    }

    try {
        // 2. Get API Token
        const token = await getSendPulseToken();

        // 3. Prepare Payload (Base64 HTML)
        const base64Html = Buffer.from(htmlContent).toString('base64');

        const payload = {
            email: {
                html: base64Html,
                text: "Your Code is enclosed.", // Simple fallback text
                subject: subject,
                from: {
                    name: "UI Market Security",
                    email: process.env.EMAIL_USER || "security@uimarket.com" // Must use a verified sender
                },
                to: [
                    {
                        name: "User", // Can make this dynamic if needed
                        email: to
                    }
                ]
            }
        };

        // 4. Send Request
        console.log(`[EMAIL] Sending OTP to ${to} via SendPulse API...`);
        const response = await axios.post(SEND_URL, payload, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.data && !response.data.error_code) {
            console.log(`[EMAIL] Success! ID: ${response.data.id}`);
            return true;
        } else {
            throw new Error('API returned success false');
        }

    } catch (err) {
        console.error(`[EMAIL] SendPulse API Error:`, err.response?.data || err.message);
        console.log("⚠️ Falling back to SMTP...");
        return fallbackSMTP(to, subject, htmlContent);
    }
}

// --- FALLBACK: STANDARD SMTP (GMAIL) ---
async function fallbackSMTP(to, subject, htmlContent) {
    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_PASS;

    if (!user || !pass) {
        console.log("⚠️ SMTP Fallback: EMAIL_USER or EMAIL_PASS missing.");
        return false;
    }

    const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: { user, pass }
    });

    try {
        console.log(`[EMAIL] Sending fallback to ${to} via Gmail SMTP...`);
        await transporter.sendMail({
            from: `"UI Market Security" <${user}>`,
            to: to,
            subject: subject,
            html: htmlContent
        });
        console.log(`[EMAIL] SMTP Fallback Success.`);
        return true;
    } catch (err) {
        console.error(`[EMAIL] SMTP Failed: ${err.message}`);
        return false;
    }
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

module.exports = { sendEmail, generateOTP };
