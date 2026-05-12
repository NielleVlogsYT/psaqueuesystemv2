import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import { getAuth, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyBv0Bnx7ESj_roRTB137vWJ7KLTDXR1C8Y",
    authDomain: "queue-project-login.firebaseapp.com",
    projectId: "queue-project-login",
    storageBucket: "queue-project-login.firebasestorage.app",
    messagingSenderId: "869956656004",
    appId: "1:869956656004:web:3d2a98bea880c701605bd1"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const authSocket = io();

async function fetchUserRole(email) {
    try {
        const response = await fetch('/api/get-role', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        if (!response.ok) return null;
        const data = await response.json();
        return data.role || null;
    } catch (error) {
        return null;
    }
}

function renderUserInfo(elementId, email, role) {
    const target = document.getElementById(elementId);
    if (!target) return;
    target.innerHTML = `
        <span>${email}</span>
        <span style="font-size:0.85rem;color:#6b7280;">Role: ${role}</span>
    `;
}

function forceLogoutHandler(kickedEmail) {
    const currentUser = auth.currentUser;
    if (currentUser && currentUser.email === kickedEmail) {
        alert("Session Terminated: You have been logged out by an Admin or logged in from another device.");
        signOut(auth).then(() => {
            localStorage.clear();
            window.location.href = "/login.html";
        });
    }
}

export async function initControllerSession({ elementId, pageLocation, allowedRoles = ['controller', 'admin'], redirectUrl = '/login.html' }) {
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = redirectUrl;
            return;
        }

        const role = await fetchUserRole(user.email);
        if (!role || !allowedRoles.includes(role) || role === 'banned') {
            alert('Unauthorized or banned account. Access denied.');
            signOut(auth).then(() => {
                localStorage.clear();
                window.location.href = redirectUrl;
            });
            return;
        }

        renderUserInfo(elementId, user.email, role);
        authSocket.emit('register_active_user', { email: user.email, role, location: pageLocation });
    });

    authSocket.on('force_logout_signal', forceLogoutHandler);
}
