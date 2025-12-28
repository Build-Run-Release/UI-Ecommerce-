const admin = require('firebase-admin');
// Check if we have env vars, otherwise fallback to file (for local dev convenience)
let credential;

if (process.env.FIREBASE_PRIVATE_KEY) {
    credential = admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // Replace literal \n characters if they were escaped in the env string
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    });
} else {
    try {
        const serviceAccount = require('./firebase_service_account.json');
        credential = admin.credential.cert(serviceAccount);
    } catch (err) {
        console.error("Firebase Auth Error: Missing credentials (env or file).");
    }
}

try {
    if (credential) {
        admin.initializeApp({ credential });
        console.log("[FIREBASE] Admin SDK Initialized.");
    }
} catch (err) {
    console.error("[FIREBASE] Error initializing Admin SDK:", err.message);
}

async function verifyFirebaseToken(idToken) {
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        return { success: true, uid: decodedToken.uid, phone_number: decodedToken.phone_number };
    } catch (error) {
        console.error("Error verifying Firebase token:", error);
        return { success: false, error: error.message };
    }
}

module.exports = { admin, verifyFirebaseToken };
