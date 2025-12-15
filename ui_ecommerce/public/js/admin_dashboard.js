function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('active');
    document.querySelector('.overlay').classList.toggle('active');
}

function openBanModal(userId, username) {
    console.log("Opening ban modal for:", userId);
    try {
        const nameSpan = document.getElementById('modalUsername');
        if (nameSpan) nameSpan.textContent = username;

        const form = document.getElementById('banForm');
        if (form) form.action = `/admin/user/${userId}/ban`;

        const typeSelect = document.getElementById('banType');
        if (typeSelect) typeSelect.value = 'permanent';

        const durationGroup = document.getElementById('durationGroup');
        // Reset UI state
        if (durationGroup) {
            durationGroup.style.display = 'none';
            const input = durationGroup.querySelector('input');
            if (input) input.required = false;
        }

        const modal = document.getElementById('banModal');
        if (modal) {
            modal.classList.add('active');
            modal.style.display = 'flex';
        }
    } catch (err) {
        console.error("Error opening modal:", err);
        alert("Error: " + err.message);
    }
}

function closeBanModal() {
    const modal = document.getElementById('banModal');
    if (modal) {
        modal.classList.remove('active');
        modal.style.display = 'none';
    }
}

function toggleDurationInput() {
    const type = document.getElementById('banType').value;
    const durationGroup = document.getElementById('durationGroup');
    const durationInput = durationGroup.querySelector('input');

    if (type === 'temporary') {
        durationGroup.style.display = 'block';
        if (durationInput) durationInput.required = true;
    } else {
        durationGroup.style.display = 'none';
        if (durationInput) durationInput.required = false;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    console.log("Admin Dashboard DOM Loaded");

    // Sidebar Toggles
    const sidebarTriggers = document.querySelectorAll('.menu-toggle, .close-sidebar, .overlay');
    sidebarTriggers.forEach(btn => {
        btn.addEventListener('click', toggleSidebar);
    });

    // Ban Buttons
    const banButtons = document.querySelectorAll('.btn-ban-trigger');
    banButtons.forEach(btn => {
        btn.addEventListener('click', function () {
            const userId = this.getAttribute('data-userid');
            const username = this.getAttribute('data-username');
            openBanModal(userId, username);
        });
    });

    // Modal Close Button
    const closeBanBtn = document.querySelector('.close-modal');
    if (closeBanBtn) {
        closeBanBtn.addEventListener('click', closeBanModal);
    }

    // Window click to close modal
    window.addEventListener('click', function (event) {
        const modal = document.getElementById('banModal');
        if (event.target === modal) {
            closeBanModal();
        }
    });

    // Ban Type Change
    const banTypeSelect = document.getElementById('banType');
    if (banTypeSelect) {
        banTypeSelect.addEventListener('change', toggleDurationInput);
    }

    // Delete Confirmation
    // We look for forms that have an specific delete action or we can attach to all delete forms
    const deleteForms = document.querySelectorAll('form[action*="/delete"]');
    deleteForms.forEach(form => {
        form.addEventListener('submit', function (e) {
            if (!confirm('Are you sure you want to permanently DELETE this user? This cannot be undone.')) {
                e.preventDefault();
            }
        });
    });
});
