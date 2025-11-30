// settings.js - Settings Page Functionality
const API_BASE = 'https://www.therein.in/api';

let currentUser = JSON.parse(localStorage.getItem('currentUser')) || null;

// API utility (same as in script.js)
const api = {
    async request(endpoint, options = {}) {
        const token = localStorage.getItem('token');
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };

        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        try {
            const response = await fetch(`${API_BASE}${endpoint}`, {
                ...options,
                headers,
                credentials: 'include'
            });

            const contentType = response.headers.get('content-type');
            let data;
            
            if (contentType && contentType.includes('application/json')) {
                data = await response.json();
            } else {
                const text = await response.text();
                throw new Error(text || `HTTP error! status: ${response.status}`);
            }
            
            if (!response.ok) {
                throw new Error(data.message || `HTTP error! status: ${response.status}`);
            }

            return data;
        } catch (error) {
            console.error('API request failed:', error);
            throw error;
        }
    },

    async get(endpoint) {
        return this.request(endpoint);
    },

    async post(endpoint, data) {
        return this.request(endpoint, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    async put(endpoint, data) {
        return this.request(endpoint, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },

    async patch(endpoint, data) {
        return this.request(endpoint, {
            method: 'PATCH',
            body: JSON.stringify(data)
        });
    },

    async delete(endpoint) {
        return this.request(endpoint, {
            method: 'DELETE'
        });
    }
};

// Initialize settings page
async function initSettings() {
    await checkAuth();
    loadUserSettings();
    setupEventListeners();
}

// Check authentication
async function checkAuth() {
    const token = localStorage.getItem('token');
    
    if (!token) {
        window.location.href = 'index.html';
        return;
    }

    try {
        const data = await api.get('/auth/me');
        if (data.success) {
            currentUser = data.user;
            updateUI();
        }
    } catch (error) {
        console.error('Auth check failed:', error);
        window.location.href = 'index.html';
    }
}

// Update UI based on authentication
function updateUI() {
    const userActions = document.getElementById('userActions');
    
    if (currentUser) {
        userActions.innerHTML = `
            <div class="user-info" onclick="window.location.href='index.html#/profile/${currentUser.username}'" style="cursor: pointer;">
                <div class="user-avatar">${getInitials(currentUser.name)}</div>
                <span>${currentUser.name}</span>
            </div>
            <button class="btn btn-ghost" onclick="logout()">Log Out</button>
        `;
    } else {
        userActions.innerHTML = `
            <a class="btn btn-outline" href="index.html">Back to App</a>
        `;
    }
}

// Load user settings
function loadUserSettings() {
    if (!currentUser) return;

    // Load notification preferences
    document.getElementById('emailNotifications').checked = 
        currentUser.preferences?.emailNotifications !== false;
    document.getElementById('pushNotifications').checked = 
        currentUser.preferences?.pushNotifications !== false;
    document.getElementById('privateAccount').checked = 
        currentUser.preferences?.privateAccount || false;
}

// Setup event listeners
function setupEventListeners() {
    // Notification toggles
    document.getElementById('emailNotifications').addEventListener('change', updateNotificationPreferences);
    document.getElementById('pushNotifications').addEventListener('change', updateNotificationPreferences);
    document.getElementById('privateAccount').addEventListener('change', updatePrivacyPreferences);
    
    // Forms
    document.getElementById('changePasswordForm').addEventListener('submit', handleChangePassword);
    document.getElementById('deleteAccountForm').addEventListener('submit', handleDeleteAccount);
    
    // Search functionality
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(function(e) {
            if (e.target.value.trim().length > 2) {
                window.location.href = `index.html?search=${encodeURIComponent(e.target.value)}`;
            }
        }, 300));
    }
}

// Update notification preferences
async function updateNotificationPreferences() {
    if (!currentUser) return;

    const preferences = {
        emailNotifications: document.getElementById('emailNotifications').checked,
        pushNotifications: document.getElementById('pushNotifications').checked
    };

    try {
        const data = await api.patch('/auth/preferences', preferences);
        if (data.success) {
            currentUser = data.user;
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            showToast('Preferences updated successfully', 'success');
        }
    } catch (error) {
        console.error('Update preferences error:', error);
        showToast('Failed to update preferences', 'error');
        // Revert UI state
        loadUserSettings();
    }
}

// Update privacy preferences
async function updatePrivacyPreferences() {
    if (!currentUser) return;

    const privateAccount = document.getElementById('privateAccount').checked;

    try {
        const data = await api.patch('/auth/preferences', { privateAccount });
        if (data.success) {
            currentUser = data.user;
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            showToast('Privacy settings updated', 'success');
        }
    } catch (error) {
        console.error('Update privacy error:', error);
        showToast('Failed to update privacy settings', 'error');
        // Revert UI state
        loadUserSettings();
    }
}

// Handle change password
async function handleChangePassword(e) {
    e.preventDefault();
    
    if (!currentUser) {
        showToast('Please log in to change password', 'error');
        return;
    }

    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPasswordChange').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    // Hide all errors
    document.getElementById('changePasswordErrorAlert').style.display = 'none';
    document.querySelectorAll('#changePasswordForm .form-error').forEach(el => el.style.display = 'none');

    let hasErrors = false;
    if (!currentPassword) {
        document.getElementById('currentPasswordError').style.display = 'block';
        hasErrors = true;
    }
    if (!newPassword || newPassword.length < 6) {
        document.getElementById('newPasswordChangeError').style.display = 'block';
        hasErrors = true;
    }
    if (newPassword !== confirmPassword) {
        document.getElementById('confirmPasswordError').style.display = 'block';
        hasErrors = true;
    }
    if (hasErrors) return;

    try {
        const data = await api.post('/auth/change-password', {
            currentPassword,
            newPassword
        });
        
        if (data.success) {
            showToast('Password changed successfully!', 'success');
            document.getElementById('changePasswordForm').reset();
            showSettingsPage();
        }
    } catch (error) {
        document.getElementById('changePasswordErrorAlert').textContent = error.message;
        document.getElementById('changePasswordErrorAlert').style.display = 'block';
    }
}

// Handle delete account
async function handleDeleteAccount(e) {
    e.preventDefault();
    
    if (!currentUser) {
        showToast('Please log in to delete account', 'error');
        return;
    }

    const password = document.getElementById('deletePassword').value;

    document.getElementById('deleteAccountErrorAlert').style.display = 'none';
    document.getElementById('deletePasswordError').style.display = 'none';

    if (!password) {
        document.getElementById('deletePasswordError').style.display = 'block';
        return;
    }

    if (!confirm('Are you absolutely sure? This action cannot be undone and will permanently delete your account and all data.')) {
        return;
    }

    try {
        const data = await api.post('/auth/delete-account', { password });
        
        if (data.success) {
            localStorage.removeItem('token');
            localStorage.removeItem('currentUser');
            showToast('Your account has been permanently deleted.', 'success');
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 2000);
        }
    } catch (error) {
        document.getElementById('deleteAccountErrorAlert').textContent = error.message;
        document.getElementById('deleteAccountErrorAlert').style.display = 'block';
    }
}

// Page navigation functions
function showChangePasswordPage() {
    document.querySelector('.settings-page').style.display = 'none';
    document.getElementById('changePasswordPage').style.display = 'block';
}

function showDeleteAccountPage() {
    document.querySelector('.settings-page').style.display = 'none';
    document.getElementById('deleteAccountPage').style.display = 'block';
}

function showSettingsPage() {
    document.querySelector('.settings-page').style.display = 'block';
    document.getElementById('changePasswordPage').style.display = 'none';
    document.getElementById('deleteAccountPage').style.display = 'none';
}

function goBack() {
    window.location.href = 'index.html';
}

// Utility functions
function getInitials(name) {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function showToast(message, type) {
    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 16px;
        border-radius: 8px;
        color: white;
        font-weight: 500;
        z-index: 10000;
        transform: translateX(100%);
        transition: transform 0.3s ease;
        max-width: 300px;
    `;
    
    if (type === 'success') {
        toast.style.background = '#10b981';
    } else if (type === 'error') {
        toast.style.background = '#ef4444';
    } else {
        toast.style.background = '#3b82f6';
    }
    
    toast.innerHTML = `
        <div class="toast-content" style="display: flex; align-items: center; gap: 8px;">
            <i class="fas fa-${type === 'success' ? 'check' : type === 'error' ? 'exclamation-triangle' : 'info'}"></i>
            <span>${message}</span>
        </div>
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.transform = 'translateX(0)';
    }, 100);
    
    setTimeout(() => {
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (toast.parentElement) {
                toast.remove();
            }
        }, 300);
    }, 3000);
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('currentUser');
    window.location.href = 'index.html';
}

// Initialize settings when page loads
document.addEventListener('DOMContentLoaded', initSettings);
