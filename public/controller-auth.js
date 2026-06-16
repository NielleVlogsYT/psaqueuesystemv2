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

export async function initControllerSession({ elementId, pageLocation, allowedRoles = ['controller', 'admin'], redirectUrl = '/login.html', dept = null, windowKey = null }) {

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

        // Register window lock if dept and windowKey are provided
        if (dept && windowKey) {
            authSocket.emit('register_controller_window', {
                dept: dept,
                windowKey: windowKey,
                email: user.email
            });
        }
    });

    authSocket.on('window_lock_error', (err) => {
        showWindowLockErrorModal(err.message);
    });

    authSocket.on('window_lock_success', (status) => {
        console.log(status.message);
    });

    authSocket.on('force_logout_signal', forceLogoutHandler);
}

function showWindowLockErrorModal(message) {
    let overlay = document.getElementById('window-lock-error-modal');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'window-lock-error-modal';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.75);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
            font-family: 'Inter', 'Segoe UI', sans-serif;
        `;
        document.body.appendChild(overlay);
    }

    overlay.innerHTML = `
        <div style="
            background: white;
            border-radius: 24px;
            padding: 40px;
            max-width: 450px;
            width: 90%;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            text-align: center;
            animation: slideIn 0.3s ease-out;
        ">
            <div style="
                width: 60px;
                height: 60px;
                background: #fee2e2;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                margin: 0 auto 20px;
                font-size: 30px;
            ">
                ⚠️
            </div>
            <h2 style="
                color: #1f2a3a;
                font-size: 22px;
                font-weight: 800;
                margin: 0 0 15px 0;
            ">
                Access Denied
            </h2>
            <p style="
                color: #666;
                font-size: 16px;
                line-height: 1.6;
                margin: 0 0 30px 0;
            ">
                ${message}
            </p>
            <button onclick="document.getElementById('window-lock-error-modal').remove(); window.location.href='/queue-control.html';" style="
                background: #1a428a;
                color: white;
                border: none;
                padding: 12px 32px;
                border-radius: 10px;
                font-size: 16px;
                font-weight: 700;
                cursor: pointer;
                transition: background 0.2s ease;
                width: 100%;
            " onmouseover="this.style.background='#0d2456'" onmouseout="this.style.background='#1a428a'">
                Return to Queue Control
            </button>
        </div>
        <style>
            @keyframes slideIn {
                from {
                    opacity: 0;
                    transform: translateY(-20px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
        </style>
    `;

    overlay.style.display = 'flex';
}

