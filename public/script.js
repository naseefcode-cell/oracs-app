// Configuration
const API_BASE = 'https://www.therein.in/api';
let currentUser = null;
let posts = [];
let currentFeed = 'all';
let notifications = [];

// Initialize app
async function initApp() {
    try {
        await checkAuth();
        setupEventListeners();
        updateUI();
        await loadPosts();
        await loadTrending();
        await loadWhoToFollow();
        
        // Show create post box if logged in
        if (currentUser) {
            document.getElementById('createPostBox').classList.add('active');
            updateUserProfileCard();
        }
    } catch (error) {
        console.error('Initialization error:', error);
        showToast('Failed to initialize app', 'error');
    }
}

// Authentication
async function checkAuth() {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
        const response = await fetch(`${API_BASE}/auth/me`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                currentUser = data.user;
                localStorage.setItem('currentUser', JSON.stringify(currentUser));
            }
        }
    } catch (error) {
        console.error('Auth check failed:', error);
        logout();
    }
}

function updateUI() {
    const userProfileCard = document.getElementById('userProfileCard');
    const createPostBox = document.getElementById('createPostBox');
    const profileNavBtn = document.getElementById('profileNavBtn');
    const mobileProfileBtn = document.getElementById('mobileProfileBtn');
    
    if (currentUser) {
        // Update user profile card
        userProfileCard.style.display = 'flex';
        document.getElementById('userName').textContent = currentUser.name || 'Anonymous';
        document.getElementById('userUsername').textContent = `@${currentUser.username}`;
        document.getElementById('userAvatar').textContent = getInitials(currentUser.name || 'A');
        document.getElementById('currentUserAvatar').textContent = getInitials(currentUser.name || 'A');
        
        // Update create post box
        createPostBox.style.display = 'block';
        
        // Enable profile navigation
        profileNavBtn.onclick = () => showProfilePage(currentUser.username);
        mobileProfileBtn.onclick = () => showProfilePage(currentUser.username);
        
        // Update nav items
        updateNavItems();
    } else {
        userProfileCard.style.display = 'none';
        createPostBox.style.display = 'none';
        
        // Redirect profile nav to login
        profileNavBtn.onclick = () => showLoginModal();
        mobileProfileBtn.onclick = () => showLoginModal();
    }
}

function updateNavItems() {
    // Update active nav item
    const currentPage = getCurrentPage();
    const navItems = document.querySelectorAll('.nav-item, .mobile-nav-item');
    
    navItems.forEach(item => {
        item.classList.remove('active');
    });
    
    // Set active based on current page
    // Implementation depends on your routing logic
}

// Posts
async function loadPosts() {
    const postsContainer = document.getElementById('postsContainer');
    postsContainer.innerHTML = '<div class="loading"><i class="fas fa-spinner loading-spinner"></i><div>Loading posts...</div></div>';
    
    try {
        const params = new URLSearchParams({
            feed: currentFeed,
            limit: 20
        });
        
        const response = await fetch(`${API_BASE}/posts?${params}`, {
            headers: getAuthHeaders()
        });
        
        if (response.ok) {
            const data = await response.json();
            posts = data.posts || [];
            renderPosts();
        }
    } catch (error) {
        console.error('Load posts error:', error);
        postsContainer.innerHTML = '<div class="p-4 text-center text-secondary">Failed to load posts</div>';
    }
}

function renderPosts() {
    const postsContainer = document.getElementById('postsContainer');
    
    if (posts.length === 0) {
        postsContainer.innerHTML = '<div class="p-4 text-center text-secondary">No posts found</div>';
        return;
    }
    
    postsContainer.innerHTML = posts.map(post => `
        <div class="post" onclick="showPostDetail('${post._id}')">
            <div class="post-header">
                <div class="post-avatar" style="background-color: ${stringToColor(post.author.name)};">
                    ${getInitials(post.author.name)}
                </div>
                <div class="post-user-info">
                    <div class="post-user-header">
                        <span class="post-author">${post.author.name}</span>
                        <span class="post-username">@${post.author.username}</span>
                        <span class="post-time">• ${formatTime(post.createdAt)}</span>
                        <span class="post-category">${post.category}</span>
                    </div>
                </div>
            </div>
            <div class="post-content">
                ${post.title ? `<h3 class="post-title">${post.title}</h3>` : ''}
                <p class="post-text ${post.content.length > 200 ? 'truncated' : ''}">
                    ${post.content}
                </p>
                ${post.content.length > 200 ? `
                    <button class="read-more-btn" onclick="event.stopPropagation(); toggleReadMore(this)">
                        Read more
                    </button>
                ` : ''}
                ${post.tags && post.tags.length > 0 ? `
                    <div class="post-tags">
                        ${post.tags.map(tag => `<span class="tag">#${tag}</span>`).join(' ')}
                    </div>
                ` : ''}
            </div>
            <div class="post-actions">
                <button class="action-btn ${post.liked ? 'liked' : ''}" onclick="event.stopPropagation(); likePost('${post._id}')">
                    <i class="fas fa-heart"></i>
                    <span>${post.likes || 0}</span>
                </button>
                <button class="action-btn" onclick="event.stopPropagation(); showComments('${post._id}')">
                    <i class="fas fa-comment"></i>
                    <span>${post.comments || 0}</span>
                </button>
                <button class="action-btn" onclick="event.stopPropagation(); sharePost('${post._id}')">
                    <i class="fas fa-share"></i>
                    <span>Share</span>
                </button>
                ${currentUser && currentUser._id === post.author._id ? `
                    <button class="action-btn" onclick="event.stopPropagation(); editPost('${post._id}')">
                        <i class="fas fa-edit"></i>
                    </button>
                ` : ''}
            </div>
        </div>
    `).join('');
}

// Create Post
async function createPost() {
    const content = document.getElementById('createPostInput').value.trim();
    if (!content) {
        showToast('Please enter some content', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/posts`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                title: '',
                content: content,
                category: 'General',
                tags: []
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            showToast('Post created successfully', 'success');
            document.getElementById('createPostInput').value = '';
            await loadPosts();
        } else {
            const error = await response.json();
            showToast(error.message || 'Failed to create post', 'error');
        }
    } catch (error) {
        console.error('Create post error:', error);
        showToast('Network error', 'error');
    }
}

async function submitPostForm() {
    const title = document.getElementById('postTitle').value.trim();
    const content = document.getElementById('postContent').value.trim();
    const category = document.getElementById('postCategory').value;
    const tags = document.getElementById('postTags').value.split(',').map(tag => tag.trim()).filter(tag => tag);
    
    if (!title || !content || !category) {
        showToast('Please fill in all required fields', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/posts`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ title, content, category, tags })
        });
        
        if (response.ok) {
            const data = await response.json();
            showToast('Post created successfully', 'success');
            closeModal('createPostModal');
            document.getElementById('postForm').reset();
            await loadPosts();
        }
    } catch (error) {
        console.error('Submit post error:', error);
        showToast('Failed to create post', 'error');
    }
}

// Edit Post
async function editPost(postId) {
    const post = posts.find(p => p._id === postId);
    if (!post) return;
    
    document.getElementById('editPostId').value = postId;
    document.getElementById('editPostTitle').value = post.title;
    document.getElementById('editPostContent').value = post.content;
    document.getElementById('editPostCategory').value = post.category;
    document.getElementById('editPostTags').value = post.tags ? post.tags.join(', ') : '';
    
    showModal('editPostModal');
}

async function submitEditPostForm() {
    const postId = document.getElementById('editPostId').value;
    const title = document.getElementById('editPostTitle').value.trim();
    const content = document.getElementById('editPostContent').value.trim();
    const category = document.getElementById('editPostCategory').value;
    const tags = document.getElementById('editPostTags').value.split(',').map(tag => tag.trim()).filter(tag => tag);
    
    try {
        const response = await fetch(`${API_BASE}/posts/${postId}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ title, content, category, tags })
        });
        
        if (response.ok) {
            showToast('Post updated successfully', 'success');
            closeModal('editPostModal');
            await loadPosts();
        }
    } catch (error) {
        console.error('Edit post error:', error);
        showToast('Failed to update post', 'error');
    }
}

// Like Post
async function likePost(postId) {
    if (!currentUser) {
        showLoginModal();
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/posts/${postId}/like`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        
        if (response.ok) {
            await loadPosts(); // Refresh posts
        }
    } catch (error) {
        console.error('Like post error:', error);
    }
}

// Comments
function showComments(postId) {
    // Implement comments functionality
    showToast('Comments feature coming soon', 'info');
}

// Share Post
function sharePost(postId) {
    const url = `${window.location.origin}/post/${postId}`;
    if (navigator.share) {
        navigator.share({
            title: 'Check out this research post',
            text: 'Interesting research on ThereIn',
            url: url
        });
    } else {
        navigator.clipboard.writeText(url);
        showToast('Link copied to clipboard', 'success');
    }
}

// Profile
async function showProfilePage(username) {
    if (!username && !currentUser) {
        showLoginModal();
        return;
    }
    
    const targetUsername = username || currentUser.username;
    
    // Hide all pages
    document.querySelectorAll('.main-content').forEach(el => el.style.display = 'none');
    
    // Show profile page
    const profilePage = document.getElementById('profilePage');
    profilePage.style.display = 'block';
    profilePage.innerHTML = '<div class="loading"><i class="fas fa-spinner loading-spinner"></i><div>Loading profile...</div></div>';
    
    try {
        const response = await fetch(`${API_BASE}/profile/${targetUsername}`, {
            headers: getAuthHeaders()
        });
        
        if (response.ok) {
            const data = await response.json();
            renderProfilePage(data.profile);
        }
    } catch (error) {
        console.error('Load profile error:', error);
        profilePage.innerHTML = '<div class="p-4 text-center text-secondary">Failed to load profile</div>';
    }
}

function renderProfilePage(profile) {
    const profilePage = document.getElementById('profilePage');
    
    profilePage.innerHTML = `
        <div class="profile-header">
            <div class="profile-background"></div>
            <div class="profile-info">
                <div class="profile-avatar-large" style="background-color: ${stringToColor(profile.name)};">
                    ${getInitials(profile.name)}
                </div>
                <div class="profile-actions">
                    ${currentUser && currentUser.username === profile.username ? `
                        <button class="btn btn-outline" onclick="showEditProfileModal()">Edit Profile</button>
                    ` : `
                        <button class="btn btn-primary" onclick="followUser('${profile.username}')">
                            ${profile.isFollowing ? 'Unfollow' : 'Follow'}
                        </button>
                    `}
                </div>
                <div class="profile-details">
                    <h1 class="profile-name">${profile.name}</h1>
                    <div class="profile-username">@${profile.username}</div>
                    ${profile.bio ? `<div class="profile-bio">${profile.bio}</div>` : ''}
                    <div class="profile-stats">
                        <div class="stat-item" onclick="showFollowers('${profile.username}')">
                            <span class="stat-number">${profile.stats?.followers || 0}</span>
                            <span class="stat-label">Followers</span>
                        </div>
                        <div class="stat-item" onclick="showFollowing('${profile.username}')">
                            <span class="stat-number">${profile.stats?.following || 0}</span>
                            <span class="stat-label">Following</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-number">${profile.stats?.posts || 0}</span>
                            <span class="stat-label">Posts</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <div id="profilePosts">
            <div class="loading">
                <i class="fas fa-spinner loading-spinner"></i>
                <div>Loading posts...</div>
            </div>
        </div>
    `;
    
    loadUserPosts(profile.username);
}

async function loadUserPosts(username) {
    try {
        const response = await fetch(`${API_BASE}/profile/${username}/posts`, {
            headers: getAuthHeaders()
        });
        
        if (response.ok) {
            const data = await response.json();
            renderUserPosts(data.posts);
        }
    } catch (error) {
        console.error('Load user posts error:', error);
    }
}

function renderUserPosts(userPosts) {
    const profilePosts = document.getElementById('profilePosts');
    
    if (!userPosts || userPosts.length === 0) {
        profilePosts.innerHTML = '<div class="p-4 text-center text-secondary">No posts yet</div>';
        return;
    }
    
    profilePosts.innerHTML = userPosts.map(post => `
        <div class="post" onclick="showPostDetail('${post._id}')">
            <div class="post-header">
                <div class="post-avatar" style="background-color: ${stringToColor(post.author.name)};">
                    ${getInitials(post.author.name)}
                </div>
                <div class="post-user-info">
                    <div class="post-user-header">
                        <span class="post-author">${post.author.name}</span>
                        <span class="post-username">@${post.author.username}</span>
                        <span class="post-time">• ${formatTime(post.createdAt)}</span>
                    </div>
                </div>
            </div>
            <div class="post-content">
                ${post.title ? `<h3 class="post-title">${post.title}</h3>` : ''}
                <p class="post-text ${post.content.length > 200 ? 'truncated' : ''}">
                    ${post.content}
                </p>
            </div>
            <div class="post-actions">
                <button class="action-btn ${post.liked ? 'liked' : ''}" onclick="event.stopPropagation(); likePost('${post._id}')">
                    <i class="fas fa-heart"></i>
                    <span>${post.likes || 0}</span>
                </button>
                <button class="action-btn" onclick="event.stopPropagation(); showComments('${post._id}')">
                    <i class="fas fa-comment"></i>
                    <span>${post.comments || 0}</span>
                </button>
            </div>
        </div>
    `).join('');
}

// Edit Profile
function showEditProfileModal() {
    if (!currentUser) return;
    
    document.getElementById('editName').value = currentUser.name || '';
    document.getElementById('editBio').value = currentUser.bio || '';
    document.getElementById('editField').value = currentUser.field || '';
    document.getElementById('editInstitution').value = currentUser.institution || '';
    document.getElementById('editLocation').value = currentUser.location || '';
    document.getElementById('editWebsite').value = currentUser.website || '';
    document.getElementById('editTwitter').value = currentUser.socialLinks?.twitter || '';
    document.getElementById('editLinkedIn').value = currentUser.socialLinks?.linkedin || '';
    document.getElementById('editGitHub').value = currentUser.socialLinks?.github || '';
    document.getElementById('editORCID').value = currentUser.socialLinks?.orcid || '';
    
    // Setup bio character counter
    const bioTextarea = document.getElementById('editBio');
    const charCount = document.getElementById('bioCharCount');
    
    bioTextarea.addEventListener('input', function() {
        const length = this.value.length;
        charCount.textContent = `${length}/500`;
    });
    
    showModal('editProfileModal');
}

async function submitEditProfileForm() {
    const formData = {
        name: document.getElementById('editName').value.trim(),
        bio: document.getElementById('editBio').value.trim(),
        field: document.getElementById('editField').value.trim(),
        institution: document.getElementById('editInstitution').value.trim(),
        location: document.getElementById('editLocation').value.trim(),
        website: document.getElementById('editWebsite').value.trim(),
        socialLinks: {
            twitter: document.getElementById('editTwitter').value.trim(),
            linkedin: document.getElementById('editLinkedIn').value.trim(),
            github: document.getElementById('editGitHub').value.trim(),
            orcid: document.getElementById('editORCID').value.trim()
        }
    };
    
    try {
        const response = await fetch(`${API_BASE}/profile/update`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(formData)
        });
        
        if (response.ok) {
            const data = await response.json();
            currentUser = data.user;
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            showToast('Profile updated successfully', 'success');
            closeModal('editProfileModal');
            updateUI();
            await showProfilePage(currentUser.username);
        }
    } catch (error) {
        console.error('Edit profile error:', error);
        showToast('Failed to update profile', 'error');
    }
}

// Authentication Forms
async function submitLoginForm() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    
    if (!email || !password) {
        showToast('Please fill in all fields', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier: email, password })
        });
        
        if (response.ok) {
            const data = await response.json();
            localStorage.setItem('token', data.token);
            localStorage.setItem('currentUser', JSON.stringify(data.user));
            currentUser = data.user;
            
            showToast('Login successful', 'success');
            closeModal('loginModal');
            updateUI();
            await loadPosts();
        } else {
            const error = await response.json();
            showToast(error.message || 'Login failed', 'error');
        }
    } catch (error) {
        console.error('Login error:', error);
        showToast('Network error', 'error');
    }
}

async function submitSignupForm() {
    const name = document.getElementById('signupName').value.trim();
    const email = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('signupPassword').value;
    const field = document.getElementById('signupField').value.trim();
    
    if (!email || !password) {
        showToast('Email and password are required', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                name: name || 'Anonymous',
                email, 
                password,
                field: field || undefined
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            showToast('Account created successfully! Please log in.', 'success');
            closeModal('signupModal');
            showLoginModal();
        } else {
            const error = await response.json();
            showToast(error.message || 'Registration failed', 'error');
        }
    } catch (error) {
        console.error('Signup error:', error);
        showToast('Network error', 'error');
    }
}

// Trending & Who to Follow
async function loadTrending() {
    try {
        const response = await fetch(`${API_BASE}/posts/trending/all`);
        if (response.ok) {
            const data = await response.json();
            renderTrending(data.posts || []);
        }
    } catch (error) {
        console.error('Load trending error:', error);
    }
}

function renderTrending(trendingPosts) {
    const trendingList = document.getElementById('trendingList');
    
    if (!trendingPosts || trendingPosts.length === 0) {
        trendingList.innerHTML = '<div class="p-4 text-center text-secondary">No trending topics</div>';
        return;
    }
    
    trendingList.innerHTML = trendingPosts.slice(0, 5).map(post => `
        <div class="trending-item" onclick="showPostDetail('${post._id}')">
            <div class="trending-topic">${post.title || 'Research Post'}</div>
            <div class="trending-stats">${post.likes || 0} likes • ${post.comments || 0} comments</div>
        </div>
    `).join('');
}

async function loadWhoToFollow() {
    try {
        const response = await fetch(`${API_BASE}/users/suggestions`, {
            headers: getAuthHeaders()
        });
        
        if (response.ok) {
            const data = await response.json();
            renderWhoToFollow(data.users || []);
        }
    } catch (error) {
        console.error('Load suggestions error:', error);
    }
}

function renderWhoToFollow(users) {
    const whoToFollow = document.getElementById('whoToFollow');
    
    if (!users || users.length === 0) {
        whoToFollow.innerHTML = '<div class="p-4 text-center text-secondary">No suggestions</div>';
        return;
    }
    
    whoToFollow.innerHTML = users.slice(0, 3).map(user => `
        <div class="follow-user">
            <div class="follow-avatar" style="background-color: ${stringToColor(user.name)};">
                ${getInitials(user.name)}
            </div>
            <div class="follow-info">
                <div class="follow-name">${user.name}</div>
                <div class="follow-username">@${user.username}</div>
            </div>
            <button class="follow-btn btn-sm" onclick="followUser('${user.username}')">
                Follow
            </button>
        </div>
    `).join('');
}

async function followUser(username) {
    if (!currentUser) {
        showLoginModal();
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/follow/${username}/follow`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        
        if (response.ok) {
            showToast('Follow updated', 'success');
            await loadWhoToFollow();
        }
    } catch (error) {
        console.error('Follow error:', error);
    }
}

// Page Navigation
function showHomePage() {
    document.querySelectorAll('.main-content').forEach(el => el.style.display = 'none');
    document.getElementById('homePage').style.display = 'block';
    updateNavItems();
}

function switchFeed(feedType) {
    if (feedType === 'following' && !currentUser) {
        showLoginModal();
        return;
    }
    
    currentFeed = feedType;
    document.querySelectorAll('.feed-tab').forEach(tab => tab.classList.remove('active'));
    event.target.classList.add('active');
    document.getElementById('feedTitle').textContent = 
        feedType === 'all' ? 'Home' : 
        feedType === 'following' ? 'Following' : 'Trending';
    
    loadPosts();
}

// Notifications
async function showAllNotifications() {
    if (!currentUser) {
        showLoginModal();
        return;
    }
    
    document.querySelectorAll('.main-content').forEach(el => el.style.display = 'none');
    const notificationsPage = document.getElementById('notificationsPage');
    notificationsPage.style.display = 'block';
    notificationsPage.innerHTML = '<div class="loading"><i class="fas fa-spinner loading-spinner"></i><div>Loading notifications...</div></div>';
    
    try {
        const response = await fetch(`${API_BASE}/notifications`, {
            headers: getAuthHeaders()
        });
        
        if (response.ok) {
            const data = await response.json();
            renderNotifications(data.notifications || []);
        }
    } catch (error) {
        console.error('Load notifications error:', error);
    }
}

function renderNotifications(notifications) {
    const notificationsPage = document.getElementById('notificationsPage');
    
    if (!notifications || notifications.length === 0) {
        notificationsPage.innerHTML = '<div class="p-4 text-center text-secondary">No notifications</div>';
        return;
    }
    
    notificationsPage.innerHTML = `
        <div class="feed-header">
            <h1>Notifications</h1>
        </div>
        <div class="notifications-list">
            ${notifications.map(notif => `
                <div class="post" onclick="handleNotificationClick('${notif._id}')">
                    <div class="post-header">
                        <div class="post-avatar" style="background-color: ${stringToColor(notif.fromUser?.name || 'System')};">
                            ${getInitials(notif.fromUser?.name || 'S')}
                        </div>
                        <div class="post-user-info">
                            <div class="post-user-header">
                                <span class="post-author">${notif.fromUser?.name || 'System'}</span>
                                <span class="post-time">${formatTime(notif.createdAt)}</span>
                            </div>
                            <div class="post-text">${notif.message}</div>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

// Modal Functions
function showModal(modalId) {
    document.getElementById(modalId).style.display = 'flex';
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

function showCreatePostModal() {
    if (!currentUser) {
        showLoginModal();
        return;
    }
    showModal('createPostModal');
}

function showLoginModal() {
    showModal('loginModal');
}

function showSignupModal() {
    showModal('signupModal');
}

function showForgotPasswordModal() {
    // Implement forgot password modal
    showToast('Forgot password feature coming soon', 'info');
}

// Utility Functions
function getAuthHeaders() {
    const token = localStorage.getItem('token');
    const headers = {
        'Content-Type': 'application/json'
    };
    
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    
    return headers;
}

function getInitials(name) {
    return name
        .split(' ')
        .map(part => part[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
}

function stringToColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    const colors = [
        '#FF6B6B', '#4ECDC4', '#FFD166', '#06D6A0',
        '#118AB2', '#073B4C', '#EF476F', '#7209B7',
        '#3A86FF', '#FB5607'
    ];
    
    return colors[Math.abs(hash) % colors.length];
}

function formatTime(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    
    return date.toLocaleDateString();
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 3000);
}

function toggleReadMore(button) {
    const postText = button.previousElementSibling;
    if (postText.classList.contains('truncated')) {
        postText.classList.remove('truncated');
        button.textContent = 'Show less';
    } else {
        postText.classList.add('truncated');
        button.textContent = 'Read more';
    }
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('currentUser');
    currentUser = null;
    updateUI();
    showHomePage();
    showToast('Logged out successfully', 'success');
}

// Event Listeners
function setupEventListeners() {
    // Create post input
    const createPostInput = document.getElementById('createPostInput');
    const postSubmitBtn = document.getElementById('postSubmitBtn');
    
    if (createPostInput && postSubmitBtn) {
        createPostInput.addEventListener('input', function() {
            postSubmitBtn.disabled = this.value.trim().length === 0;
        });
    }
    
    // Search input
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                searchPosts(this.value);
            }
        });
    }
    
    // Close modals on background click
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', function(e) {
            if (e.target === this) {
                this.style.display = 'none';
            }
        });
    });
    
    // Escape key to close modals
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal').forEach(modal => {
                modal.style.display = 'none';
            });
        }
    });
}

async function searchPosts(query) {
    if (!query.trim()) return;
    
    try {
        const response = await fetch(`${API_BASE}/posts?search=${encodeURIComponent(query)}`);
        if (response.ok) {
            const data = await response.json();
            posts = data.posts || [];
            renderPosts();
            showToast(`Found ${posts.length} results`, 'info');
        }
    } catch (error) {
        console.error('Search error:', error);
    }
}

// Post Detail (simplified)
async function showPostDetail(postId) {
    // Hide all pages
    document.querySelectorAll('.main-content').forEach(el => el.style.display = 'none');
    
    // Show post detail page
    const postPage = document.getElementById('postPage');
    postPage.style.display = 'block';
    postPage.innerHTML = '<div class="loading"><i class="fas fa-spinner loading-spinner"></i><div>Loading post...</div></div>';
    
    try {
        const response = await fetch(`${API_BASE}/posts/${postId}`, {
            headers: getAuthHeaders()
        });
        
        if (response.ok) {
            const data = await response.json();
            renderPostDetail(data.post);
        }
    } catch (error) {
        console.error('Load post detail error:', error);
        postPage.innerHTML = '<div class="p-4 text-center text-secondary">Failed to load post</div>';
    }
}

function renderPostDetail(post) {
    const postPage = document.getElementById('postPage');
    
    postPage.innerHTML = `
        <div class="feed-header">
            <button class="btn btn-outline btn-sm" onclick="showHomePage()">
                <i class="fas fa-arrow-left"></i> Back
            </button>
        </div>
        <div class="post">
            <div class="post-header">
                <div class="post-avatar" style="background-color: ${stringToColor(post.author.name)};">
                    ${getInitials(post.author.name)}
                </div>
                <div class="post-user-info">
                    <div class="post-user-header">
                        <span class="post-author">${post.author.name}</span>
                        <span class="post-username">@${post.author.username}</span>
                        <span class="post-time">• ${formatTime(post.createdAt)}</span>
                        <span class="post-category">${post.category}</span>
                    </div>
                </div>
            </div>
            <div class="post-content">
                ${post.title ? `<h1 class="post-title" style="font-size: 24px;">${post.title}</h1>` : ''}
                <div class="post-text" style="white-space: pre-wrap; font-size: 17px; line-height: 1.6;">
                    ${post.content}
                </div>
                ${post.tags && post.tags.length > 0 ? `
                    <div class="post-tags mt-4">
                        ${post.tags.map(tag => `<span class="tag">#${tag}</span>`).join(' ')}
                    </div>
                ` : ''}
            </div>
            <div class="post-actions mt-4">
                <button class="action-btn ${post.liked ? 'liked' : ''}" onclick="likePost('${post._id}')">
                    <i class="fas fa-heart"></i>
                    <span>${post.likes || 0}</span>
                </button>
                <button class="action-btn" onclick="showComments('${post._id}')">
                    <i class="fas fa-comment"></i>
                    <span>${post.comments || 0}</span>
                </button>
                <button class="action-btn" onclick="sharePost('${post._id}')">
                    <i class="fas fa-share"></i>
                    <span>Share</span>
                </button>
                ${currentUser && currentUser._id === post.author._id ? `
                    <button class="action-btn" onclick="editPost('${post._id}')">
                        <i class="fas fa-edit"></i>
                    </button>
                ` : ''}
            </div>
        </div>
        <div class="comments-section">
            <h3 class="p-4" style="font-size: 18px; font-weight: 700;">Comments</h3>
            <div class="comment-form p-4">
                <textarea class="comment-input" placeholder="Add a comment..."></textarea>
                <button class="comment-submit-btn mt-2">Post Comment</button>
            </div>
            <div class="comments-list">
                <div class="p-4 text-center text-secondary">No comments yet</div>
            </div>
        </div>
    `;
}

// Settings
function showSettingsModal() {
    // Implement settings modal
    showToast('Settings feature coming soon', 'info');
}

// Initialize
document.addEventListener('DOMContentLoaded', initApp);

// Make functions globally available
window.showHomePage = showHomePage;
window.showProfilePage = showProfilePage;
window.showAllNotifications = showAllNotifications;
window.showCreatePostModal = showCreatePostModal;
window.showLoginModal = showLoginModal;
window.showSignupModal = showSignupModal;
window.switchFeed = switchFeed;
window.likePost = likePost;
window.editPost = editPost;
window.sharePost = sharePost;
window.showComments = showComments;
window.createPost = createPost;
window.submitPostForm = submitPostForm;
window.submitEditPostForm = submitEditPostForm;
window.submitLoginForm = submitLoginForm;
window.submitSignupForm = submitSignupForm;
window.submitEditProfileForm = submitEditProfileForm;
window.showEditProfileModal = showEditProfileModal;
window.followUser = followUser;
window.closeModal = closeModal;
window.logout = logout;
window.toggleReadMore = toggleReadMore;
