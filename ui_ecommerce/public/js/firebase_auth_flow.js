// public/js/firebase_auth_flow.js

window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
    'size': 'normal',
    'callback': (response) => {
        // reCAPTCHA solved, allow signInWithPhoneNumber.
        console.log("Recaptcha Verified");
    }
});

function onSignInSubmit(phoneNumber) {
    const appVerifier = window.recaptchaVerifier;
    firebase.auth().signInWithPhoneNumber(phoneNumber, appVerifier)
        .then((confirmationResult) => {
            // SMS sent. Prompt user to type the code from the message, then sign the
            // user in with confirmationResult.confirm(code).
            window.confirmationResult = confirmationResult;
            console.log("SMS Sent");
            document.getElementById('step-1').style.display = 'none';
            document.getElementById('step-2').style.display = 'block';
        }).catch((error) => {
            // Error; SMS not sent
            // ...
            console.error("Error sending SMS", error);
            alert("Error sending SMS: " + error.message);
        });
}

function verifyCode() {
    const code = document.getElementById('otp-input').value;
    if (!window.confirmationResult) return;

    window.confirmationResult.confirm(code).then((result) => {
        // User signed in successfully.
        const user = result.user;

        // Get ID Token
        user.getIdToken().then((idToken) => {
            // Send to backend
            fetch('/auth/verify-firebase', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'CSRF-Token': document.querySelector('meta[name="csrf-token"]').getAttribute('content')
                },
                body: JSON.stringify({ idToken: idToken })
            })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        window.location.href = data.redirectUrl;
                    } else {
                        alert("Backend Verification Failed: " + data.error);
                    }
                });
        });

    }).catch((error) => {
        // User couldn't sign in (bad verification code?)
        alert("Invalid Code");
    });
}
