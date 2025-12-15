document.addEventListener('DOMContentLoaded', function () {
    // --- Global Error Handler for Images (CSP Compliant) ---
    // Use capture phase to catch non-bubbling error events
    window.addEventListener('error', function (e) {
        if (e.target.tagName && e.target.tagName.toLowerCase() === 'img') {
            // Check if we already replaced it to prevent loops
            if (!e.target.dataset.replaced) {
                console.log('Image load error fixed:', e.target.src);
                e.target.src = '/images/placeholder.svg';
                e.target.dataset.replaced = "true";
                e.target.onerror = null;
            }
        }
    }, true);

    // --- Ad Banner Close Logic ---
    const closeAdBtns = document.querySelectorAll('.close-ad-btn');
    closeAdBtns.forEach(btn => {
        btn.addEventListener('click', function () {
            if (this.parentElement) {
                this.parentElement.style.display = 'none';
            }
        });
    });

    // --- Report Modal Logic ---
    const openReportBtn = document.getElementById('openReportModalBtn');
    const closeReportBtn = document.getElementById('closeReportModalBtn');
    const reportModal = document.getElementById('reportModal');

    if (openReportBtn && reportModal) {
        openReportBtn.addEventListener('click', function () {
            reportModal.classList.add('active'); // Using 'active' class for display:block
        });
    }

    if (closeReportBtn && reportModal) {
        closeReportBtn.addEventListener('click', function () {
            reportModal.classList.remove('active');
        });
    }

    // Close modal on outside click
    window.addEventListener('click', function (e) {
        if (e.target === reportModal) {
            reportModal.classList.remove('active');
        }
    });
});
