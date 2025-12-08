const axios = require('axios');

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

/**
 * Create a Transfer Recipient (needed before transferring money)
 * @param {string} name - Account Holder Name
 * @param {string} account_number - Account Number
 * @param {string} bank_code - Bank Code (e.g. "057" for Zenith)
 */
async function createTransferRecipient(name, account_number, bank_code) {
    try {
        const response = await axios.post(
            'https://api.paystack.co/transferrecipient',
            {
                type: "nuban",
                name: name,
                account_number: account_number,
                bank_code: bank_code,
                currency: "NGN"
            },
            {
                headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
            }
        );
        return { success: true, code: response.data.data.recipient_code };
    } catch (error) {
        console.error("Create Recipient Error:", error.response ? error.response.data : error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Initiate a Transfer (Payout)
 * @param {string} recipient_code - The 'RCP_...' code
 * @param {number} amount - Amount in Naira
 * @param {string} reason - Reason for transfer
 */
async function initiateTransfer(recipient_code, amount, reason = 'Seller Payout') {
    try {
        const response = await axios.post(
            'https://api.paystack.co/transfer',
            {
                source: "balance",
                reason: reason,
                amount: amount * 100, // Convert to Kobo
                recipient: recipient_code
            },
            {
                headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
            }
        );
        return { success: true, data: response.data.data };
    } catch (error) {
        console.error("Transfer Error:", error.response ? error.response.data : error.message);
        return { success: false, error: error.message };
    }
}

module.exports = { createTransferRecipient, initiateTransfer };
