document.addEventListener('DOMContentLoaded', function () {

    // --- Sidebar Toggle ---
    function toggleSidebar() {
        document.getElementById('sidebar').classList.toggle('active');
        document.querySelector('.overlay').classList.toggle('active');
    }

    const sidebarTriggers = document.querySelectorAll('.menu-toggle, .close-sidebar, .overlay');
    sidebarTriggers.forEach(btn => {
        btn.addEventListener('click', toggleSidebar);
    });

    // --- Fund Account (Paystack) ---
    const fundBtn = document.getElementById('fundAccountBtn');

    if (fundBtn) {
        fundBtn.addEventListener('click', function () {
            const paystackKey = this.dataset.paystackKey;
            const userEmail = this.dataset.userEmail;

            if (!paystackKey) {
                console.error("Paystack key not found");
                alert("System Error: Payment configuration missing.");
                return;
            }

            const amountStr = prompt("Enter amount to fund (₦):");
            if (!amountStr) return; // Cancelled

            const amount = parseFloat(amountStr);
            if (isNaN(amount) || amount <= 0) {
                alert("Please enter a valid amount.");
                return;
            }

            const handler = PaystackPop.setup({
                key: paystackKey,
                email: userEmail,
                amount: amount * 100, // Convert to Kobo
                currency: "NGN",
                ref: '' + Math.floor((Math.random() * 1000000000) + 1),
                callback: function (response) {
                    window.location.href = "/paystack/verify?reference=" + response.reference;
                },
                onClose: function () {
                    alert('Transaction was closed.');
                }
            });

            handler.openIframe();
        });
    }
});
