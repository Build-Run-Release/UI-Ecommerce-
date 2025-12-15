window.addEventListener('scroll', function () {
    var header = document.querySelector('header');
    if (header) {
        header.classList.toggle('sticky', window.scrollY > 0);
    }
});

function toggleMenu() {
    console.log("Toggle menu clicked");
    var menuToggle = document.querySelector('.toggle');
    var menu = document.querySelector('.menu');
    if (menuToggle) menuToggle.classList.toggle('active');
    if (menu) menu.classList.toggle('active');
}

document.addEventListener('DOMContentLoaded', function () {
    // --- Helper Functions ---
    function toggleModal(modalId) {
        console.log("Toggling modal:", modalId);
        const modal = document.getElementById(modalId);
        if (modal) modal.classList.toggle('active');
        else console.error("Modal not found:", modalId);
    }

    function toggleSidebar() {
        document.getElementById('sidebar').classList.toggle('active');
        document.querySelector('.overlay').classList.toggle('active');
    }

    // --- Event Delegation for Dynamic Content ---
    document.body.addEventListener('click', function (e) {
        // Profile Dropdown Toggle
        if (e.target.closest('#profileImgTrigger')) {
            e.stopPropagation();
            document.getElementById("profileDropdown").classList.toggle("show");
        } else {
            // Close dropdown if clicking outside
            if (!e.target.closest('.profile-actions')) {
                document.querySelectorAll('.dropdown-menu.show').forEach(el => el.classList.remove('show'));
            }
        }

        // Modal Closer (Clicking background)
        if (e.target.classList.contains('modal')) {
            e.target.classList.remove('active');
        }
    });

    // --- Global Error Handler for Images (CSP Compliant) ---
    window.addEventListener('error', function (e) {
        if (e.target.tagName && e.target.tagName.toLowerCase() === 'img') {
            console.log('Image load error fixed:', e.target.src);

            // Profile Image Fallback check
            if (e.target.classList.contains('profile-img')) {
                e.target.src = 'https://ui-avatars.com/api/?name=User&background=4f46e5&color=fff';
            } else {
                e.target.src = '/images/placeholder.svg';
            }

            // Prevent infinite loop
            e.target.onerror = null;
        }
    }, true); // useCapture is TRUE

    // --- Static Event Listeners ---

    // Sidebar Triggers
    const menuToggle = document.getElementById('menuToggleBtn');
    if (menuToggle) menuToggle.addEventListener('click', toggleSidebar);

    const closeSidebar = document.getElementById('closeSidebarBtn');
    if (closeSidebar) closeSidebar.addEventListener('click', toggleSidebar);

    const overlay = document.getElementById('mainOverlay');
    if (overlay) overlay.addEventListener('click', toggleSidebar);

    // Add Product Triggers
    const addBtns = ['navAddProductBtn', 'headerAddProductBtn', 'inventoryAddProductBtn'];
    addBtns.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                toggleModal('addProductModal');
            });
        }
    });

    // Close Modal Triggers
    const closeAdd = document.getElementById('closeAddProductModalBtn');
    if (closeAdd) closeAdd.addEventListener('click', () => toggleModal('addProductModal'));

    const closeEdit = document.getElementById('closeEditProductModalBtn');
    if (closeEdit) closeEdit.addEventListener('click', () => toggleModal('editProductModal'));

    // File Upload Triggers
    const uploadBox = document.getElementById('fileUploadBox');
    if (uploadBox) {
        uploadBox.addEventListener('click', () => document.getElementById('prodImg').click());
    }

    const prodImg = document.getElementById('prodImg');
    if (prodImg) {
        prodImg.addEventListener('change', function () {
            const preview = document.getElementById('imgPreview');
            const container = document.getElementById('previewContainer');
            const file = this.files[0];
            const reader = new FileReader();

            reader.onloadend = function () {
                preview.src = reader.result;
                container.style.display = 'block';
            }

            if (file) reader.readAsDataURL(file);
            else preview.src = "";
        });
    }

    // --- Edit Buttons (Class based) ---
    document.querySelectorAll('.edit-product-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const { id, title, price, desc, cat } = this.dataset;

            document.getElementById('editTitle').value = title;
            document.getElementById('editPrice').value = price;
            document.getElementById('editDesc').value = desc;
            document.getElementById('editCategory').value = cat || 'Other';
            document.getElementById('editForm').action = "/seller/product/" + id + "/edit";

            toggleModal('editProductModal');
        });
    });

    // --- Confirmation Forms ---
    document.querySelectorAll('form[data-confirm]').forEach(form => {
        form.addEventListener('submit', function (e) {
            if (!confirm(this.dataset.confirm)) {
                e.preventDefault();
            }
        });
    });
});
