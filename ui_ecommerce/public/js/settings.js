document.addEventListener('DOMContentLoaded', () => {
    // --- Alert Message Handling ---
    const urlParams = new URLSearchParams(window.location.search);
    const msg = urlParams.get('msg');
    const error = urlParams.get('error');
    const container = document.getElementById('alertContainer');

    if (container) {
        if (msg === 'profile_updated') {
            container.innerHTML = '<div class="alert alert-success">Profile details updated successfully!</div>';
        } else if (msg === 'password_changed') {
            container.innerHTML = '<div class="alert alert-success">Password changed successfully!</div>';
        } else if (error === 'invalid_password') {
            container.innerHTML = '<div class="alert alert-error">Incorrect current password. Please try again.</div>';
        } else if (error === 'invalid_captcha') {
            container.innerHTML = '<div class="alert alert-error">Invalid Captcha Code. Please try again.</div>';
        }
    }

    // --- Captcha Refresh ---
    const captchaImg = document.querySelector('.captcha-img');
    if (captchaImg) {
        captchaImg.addEventListener('click', function () {
            this.src = '/captcha?' + Math.random();
        });
    }
});
