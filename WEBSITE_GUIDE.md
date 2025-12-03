# University of Ibadan Ecommerce - User Guide

Welcome to the UI Ecommerce platform documentation.

## Getting Started

1.  **Installation**:
    ```bash
    cd ui_ecommerce
    npm install
    npm start
    ```
2.  **Access**: Open `http://localhost:3000` in your browser.

## User Roles

### 1. Buyers
*   **Sign Up**: Create an account by selecting "Buyer" as your role.
*   **Browse**: View all products on the home page.
*   **Buy**: Click "Buy Now" on any product.
*   **Checkout**: Review the price (including 10% service fee) and click "Pay with Paystack".
    *   *Note*: In this demo, payment is simulated. You will see a success screen immediately.

### 2. Sellers
*   **Sign Up**: Create an account by selecting "Seller" as your role.
*   **Dashboard**: Access your dashboard to manage your shop.
*   **Onboarding**: You **must** add your bank details in the dashboard to receive payments.
*   **Add Products**: List new items with a Title, Description, and Price.
*   **View Orders**: See a list of all items you have sold.

## Payment System (Paystack)

This platform uses Paystack to handle payments securely.

*   **Service Fee**: A standard 10% service fee is applied to all transactions. This is deducted automatically.
*   **Settlement**: The remaining 90% is sent directly to the seller's provided bank account.

## Technical Details

*   **Backend**: Node.js with Express.
*   **Database**: SQLite (persisted in `data/ecommerce.db`).
*   **Frontend**: EJS Templates.
*   **Payment**: Paystack API (Simulated in this demo).
