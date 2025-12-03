# Paystack Integration Guide for University of Ibadan Ecommerce

This guide explains how to fully implement the payment system using Paystack, ensuring:
1.  **Platform Owner (You)**: Receives the 10% service fee automatically.
2.  **Sellers**: Receive their 90% share directly to their bank accounts.
3.  **Buyers**: Pay securely via Paystack (Card, Bank Transfer, USSD).

## Core Concept: Paystack Split Payments (Subaccounts)

To split payments between you (the platform) and the sellers, we use **Paystack Subaccounts**.

### 1. Platform Setup (Your Details)

1.  Sign up at [paystack.com](https://paystack.com).
2.  Go to **Settings > API Keys & Webhooks**.
3.  Copy your `Secret Key` and `Public Key`.
4.  Add these to your `.env` file or environment variables.

### 2. Seller Onboarding (Collecting Bank Details)

Sellers must provide their Nigerian bank account details to receive funds.

**The Flow:**
1.  Seller logs in to your dashboard.
2.  Seller enters Bank Name, Account Number, and Bank Code.
3.  Your server sends this to Paystack to create a **Subaccount**:
    ```javascript
    const response = await axios.post('https://api.paystack.co/subaccount', {
      business_name: 'Seller Business Name',
      settlement_bank: '058', // GTBank code
      account_number: '0123456789',
      percentage_charge: 10 // Platform takes 10% fee
    }, { headers: { Authorization: `Bearer YOUR_SECRET_KEY` } });
    ```
4.  Paystack returns a `subaccount_code` (e.g., `ACCT_xxxx`). You save this to the seller's record in your database.

**Note:** In our current simulation, we mock this step and generate a fake `subaccount_code`.

### 3. Buyer Payment & Internal Escrow

To support 2-way verification and fraud prevention, we do **not** use Paystack Split Payments immediately. Instead, we use an **Internal Escrow** model.

**The Flow:**
1.  **Payment:** The buyer pays the full amount (e.g., NGN 100.00) to the **Platform's Main Account**.
2.  **Escrow:** The funds are held in the Platform's account. In the database, the order status is `paid` but `escrow_released` is `false`.
3.  **Confirmation:**
    *   The Buyer clicks "Confirm Receipt" on their dashboard.
    *   The Seller clicks "Confirm Delivery" on their dashboard.
4.  **Release:** Once both parties confirm, the system updates the seller's **Internal Wallet Balance**.
5.  **Withdrawal:** The seller can request a withdrawal. The platform then uses **Paystack Transfers** to send funds from the Main Account to the Seller's bank account.

**The Code Logic:**

```javascript
// 1. Charge full amount to Main Account
const response = await axios.post('https://api.paystack.co/transaction/initialize', {
  email: buyer_email,
  amount: amount_in_kobo
});

// 2. On verification, record order but DO NOT credit wallet yet.
// 3. When buyer_confirmed=1 AND seller_confirmed=1:
//    UPDATE users SET wallet_balance = wallet_balance + (amount - 10%) WHERE id = seller_id;
```

**Security Warning:** The current simulation uses a GET request to verify payments for demonstration purposes. In a production environment, you **must** verify transactions server-side using the Paystack API and Webhooks to prevent fraud.

### Summary of Steps to Go Live

1.  **Get Keys**: Register on Paystack and get your live keys.
2.  **Uncomment Logic**: In `server.js`, uncomment the `axios` calls to Paystack API.
3.  **Verify Bank Codes**: Ensure sellers enter valid bank codes (you can use Paystack's List Banks API to populate a dropdown).
