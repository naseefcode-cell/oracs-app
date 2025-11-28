const API_BASE = 'https://www.therein.in/api';

// Enhanced State Management
let currentUser = JSON.parse(localStorage.getItem('currentUser')) || null;
let posts = [];
let currentProfileUsername = null;
let notifications = [];
let unreadNotificationCount = 0;
let currentProfile = null;
let currentFeed = 'all'; // 'all', 'following', 'trending', 'my-posts'
let currentSort = 'hot'; // 'hot', 'new', 'old', 'top', 'trending'
let currentPostId = null;
let userLikes = JSON.parse(localStorage.getItem('userLikes')) || {}; // Track user likes
let searchSuggestionsTimeout;
// DOM Elements
const userActions = document.getElementById('userActions');
const createPostContainer = document.getElementById('createPostContainer');
const postsList = document.getElementById('postsList');
const trendingList = document.getElementById('trendingList');
const searchInput = document.getElementById('searchInput');
const homePage = document.getElementById('homePage');
const profilePage = document.getElementById('profilePage');
const notificationsPage = document.getElementById('notificationsPage');
const postPage = document.getElementById('postPage');

// API utility
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
                credentials: 'include' // Include cookies for production
            });

            // Handle non-JSON responses
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

    async delete(endpoint) {
        return this.request(endpoint, {
            method: 'DELETE'
        });
    },

    async patch(endpoint, data) {
        return this.request(endpoint, {
            method: 'PATCH',
            body: JSON.stringify(data)
        });
    }
};
// RealTimeClient for instant updates
class RealTimeClient {
    constructor() {
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.isConnected = false;
        this.typingTimeouts = {};
    }

    connect() {
        const token = localStorage.getItem('token');
        if (!token) return;

        try {
            // Use secure WebSocket for production
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'wss:';
            const host = 'www.therein.in';
            const wsUrl = `${protocol}//${host}?token=${token}`;
            
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log('✅ WebSocket connected to production server');
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.showToast('Real-time connection established', 'success', 2000);
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                } catch (error) {
                    console.error('WebSocket message error:', error);
                }
            };

            this.ws.onclose = (event) => {
                console.log('❌ WebSocket disconnected');
                this.isConnected = false;
                if (event.code !== 1000) {
                    this.attemptReconnect();
                }
            };

            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
            };

        } catch (error) {
            console.error('WebSocket connection failed:', error);
        }
    }

     handleMessage(data) {
        switch (data.type) {
            case 'new_post':
                this.handleNewPost(data.post);
                break;
            case 'post_updated':
                this.handleUpdatedPost(data.post);
                break;
            case 'post_deleted':
                this.handleDeletedPost(data.postId);
                break;
            case 'post_like_updated':
                this.handlePostLikeUpdate(data.postId, data.userId, data.liked, data.likeCount);
                break;
            case 'new_comment':
                this.handleNewComment(data.postId, data.comment);
                break;
            case 'comment_like_updated':
                this.handleCommentLikeUpdate(data.postId, data.commentId, data.userId, data.liked, data.likeCount);
                break;
            case 'comment_deleted':
                this.handleCommentDeleted(data.postId, data.commentId);
                break;
            case 'reply_added':
                this.handleReplyAdded(data.postId, data.commentId, data.reply);
                break;
            case 'reply_deleted':
                this.handleReplyDelete(data.postId, data.commentId, data.replyId);
                break;
            case 'new_notification':
                this.handleNewNotification(data.notification);
                break;
            case 'user_typing':
                this.handleUserTyping(data.postId, data.userId, data.username, data.typing);
                break;
            case 'follow_updated':
                this.handleFollowUpdated(data);
                break;
            case 'follow_status_updated':
                this.handleFollowStatusUpdated(data);
                break;
            case 'user_updated':
                this.handleUserUpdated(data);
                break;
            case 'connection_established':
                console.log('✅ Real-time connection established');
                break;
            case 'ping':
                this.send({ type: 'pong', timestamp: Date.now() });
                break;
            case 'reply_like_updated':
                this.handleReplyLikeUpdated(data);
                break;
        }
    }

    // Handle comment deletion in real-time
    handleCommentDeleted(postId, commentId) {
        const commentElement = document.querySelector(`[data-comment-id="${commentId}"]`);
        if (commentElement) {
            commentElement.style.opacity = '0.5';
            setTimeout(() => {
                commentElement.remove();
                this.updateCommentCount(postId, -1);
            }, 300);
        }
        
        // ALSO update post detail page if open
        if (currentPostId === postId) {
            const postDetailComment = document.querySelector(`[data-comment-id="${commentId}"]`);
            if (postDetailComment) {
                postDetailComment.style.opacity = '0.5';
                setTimeout(() => {
                    postDetailComment.remove();
                    this.updatePostDetailCommentCount(-1);
                }, 300);
            }
        }
    }

handleReplyLikeUpdated(data) {
    console.log('WebSocket: Reply like update', { 
        postId: data.postId, 
        replyId: data.replyId, 
        userId: data.userId, 
        liked: data.liked, 
        likeCount: data.likeCount 
    });
    
    // Update ALL reply elements with this ID (both in feed and post detail)
    const replyElements = document.querySelectorAll(`[data-reply-id="${data.replyId}"]`);
    
    replyElements.forEach(replyElement => {
        const likeBtn = replyElement.querySelector('.comment-action-btn:first-child');
        const likeCountSpan = likeBtn?.querySelector('span');
        
        if (likeBtn && likeCountSpan) {
            likeCountSpan.textContent = data.likeCount;
            
            // Update like state for current user
            if (data.userId === currentUser?._id) {
                if (data.liked) {
                    likeBtn.classList.add('liked');
                } else {
                    likeBtn.classList.remove('liked');
                }
            }
        }
    });
}

    // Handle reply addition in real-time
    handleReplyAdded(postId, commentId, reply) {
        const commentElement = document.querySelector(`[data-comment-id="${commentId}"]`);
        if (commentElement) {
            const repliesContainer = commentElement.querySelector('.replies');
            const replyForm = commentElement.querySelector('.reply-form');
            
            if (!repliesContainer) {
                // Create replies container if it doesn't exist
                const commentContent = commentElement.querySelector('.flex-1');
                const repliesHTML = `
                    <div class="replies mt-4 ml-6 border-l-2 pl-4" style="border-color: var(--border-color);">
                        ${this.createReplyHTML(reply, postId, commentId)}
                    </div>
                `;
                commentContent.insertAdjacentHTML('beforeend', repliesHTML);
            } else {
                // Add reply to existing container
                const replyHTML = this.createReplyHTML(reply, postId, commentId);
                repliesContainer.insertAdjacentHTML('beforeend', replyHTML);
            }
            
            // Hide the reply form
            if (replyForm) {
                replyForm.classList.add('hidden');
                const textarea = replyForm.querySelector('textarea');
                if (textarea) textarea.value = '';
            }
            
            // Update comment count (reply counts as a comment)
            this.updateCommentCount(postId, 1);
            
            // Update UI if we're on the post detail page
            if (currentPostId === postId) {
                this.updatePostDetailCommentCount(1);
            }
        }
    }

    // Handle reply deletion in real-time
    handleReplyDelete(postId, commentId, replyId) {
        const replyElement = document.querySelector(`[data-reply-id="${replyId}"]`);
        if (replyElement) {
            replyElement.style.opacity = '0.5';
            setTimeout(() => {
                replyElement.remove();
                
                // Remove empty replies container if this was the last reply
                const repliesContainer = document.querySelector(`[data-comment-id="${commentId}"] .replies`);
                if (repliesContainer && repliesContainer.children.length === 0) {
                    repliesContainer.remove();
                }
            }, 300);
        }
    }

    // Update post detail comment count
    updatePostDetailCommentCount(change) {
        // Update comment count in post actions
        const commentBtn = document.querySelector('.post-detail-actions .action-btn:nth-child(2) span');
        if (commentBtn) {
            const currentCount = parseInt(commentBtn.textContent) || 0;
            commentBtn.textContent = Math.max(0, currentCount + change);
        }
        
        // Also update the comment count in the post stats
        const commentStat = document.querySelector('.post-stats .stat:nth-child(3) span');
        if (commentStat) {
            const currentCount = parseInt(commentStat.textContent) || 0;
            commentStat.textContent = Math.max(0, currentCount + change);
        }
        
        // Update the comments header
        const commentsHeader = document.querySelector('.card-header h3.card-title');
        if (commentsHeader) {
            const currentText = commentsHeader.textContent;
            const newCount = Math.max(0, (parseInt(commentBtn?.textContent) || 0));
            commentsHeader.innerHTML = `<i class="fas fa-comments"></i> Comments (${newCount})`;
        }
    }

    // Follow-related handlers
    handleFollowUpdated(data) {
        console.log('Follow updated:', data);
        // Handle when someone follows/unfollows the current user
        if (currentProfile && currentProfile._id === data.followerId) {
            this.updateFollowerCount(data.following ? 1 : -1);
        }
        
        // Update UI if we're on the profile page of the user being followed/unfollowed
        if (currentProfileUsername && currentProfile) {
            this.updateProfileFollowStatus(data);
        }
        
        // Refresh open modals
        this.refreshOpenModals();
    }
    // Add this method to the RealTimeClient class
handleReplyLikeUpdated(data) {
  console.log('WebSocket: Reply like update', { 
    postId: data.postId, 
    replyId: data.replyId, 
    userId: data.userId, 
    liked: data.liked, 
    likeCount: data.likeCount 
  });
  
  // Update ALL reply elements with this ID (both in feed and post detail)
  const replyElements = document.querySelectorAll(`[data-reply-id="${data.replyId}"]`);
  
  replyElements.forEach(replyElement => {
    const likeBtn = replyElement.querySelector('.comment-action-btn:first-child');
    const likeCountSpan = likeBtn?.querySelector('span');
    
    if (likeBtn && likeCountSpan) {
      likeCountSpan.textContent = data.likeCount;
      
      // Update like state for current user
      if (data.userId === currentUser?._id) {
        if (data.liked) {
          likeBtn.classList.add('liked');
        } else {
          likeBtn.classList.remove('liked');
        }
      }
    }
  });
}
    
    handleFollowStatusUpdated(data) {
        console.log('Follow status updated:', data);
        // Handle when current user follows/unfollows someone
        if (currentProfile && currentProfile._id === data.targetUserId) {
            this.updateFollowButton(data.following);
        }
        
        // Update current user's following list
        if (currentUser) {
            if (!currentUser.following) currentUser.following = [];
            
            if (data.following) {
                // Add to following list if not already there
                if (!currentUser.following.some(f => f._id === data.targetUserId || f === data.targetUserId)) {
                    currentUser.following.push({ _id: data.targetUserId });
                }
            } else {
                // Remove from following list
                currentUser.following = currentUser.following.filter(f => 
                    !(f._id === data.targetUserId || f === data.targetUserId)
                );
            }
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
        }
        
        // Refresh open modals
        this.refreshOpenModals();
    }

    handleUserUpdated(data) {
        // Update user information in real-time
        if (currentUser && currentUser._id === data.user.id) {
            Object.assign(currentUser, data.user);
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
        }
        
        // Update profile if we're viewing the updated user
        if (currentProfile && currentProfile._id === data.user.id) {
            Object.assign(currentProfile, data.user);
            this.updateProfileUI();
        }
    }

    updateFollowerCount(change) {
        const followerCountElement = document.querySelector('.stat-item:nth-child(1) .stat-number');
        if (followerCountElement) {
            const currentCount = parseInt(followerCountElement.textContent) || 0;
            followerCountElement.textContent = Math.max(0, currentCount + change);
            
            // Update currentProfile stats
            if (currentProfile) {
                currentProfile.stats.followerCount = Math.max(0, currentCount + change);
            }
        }
    }

    updateFollowButton(following) {
        const followBtn = document.querySelector('.btn-follow, .btn-unfollow');
        if (followBtn) {
            followBtn.textContent = following ? 'Unfollow' : 'Follow';
            followBtn.className = following ? 'btn btn-unfollow' : 'btn btn-follow';
            
            // Update currentProfile state
            if (currentProfile) {
                currentProfile.isFollowing = following;
            }
        }
    }

    updateProfileFollowStatus(data) {
        // Update the profile's follow status and counts
        if (currentProfile) {
            const followerCountElement = document.querySelector('.stat-item:nth-child(1) .stat-number');
            if (followerCountElement) {
                followerCountElement.textContent = currentProfile.stats.followerCount;
            }
        }
    }

    updateProfileUI() {
        // Refresh profile UI with updated data
        if (currentProfileUsername) {
            this.debouncedProfileUpdate();
        }
    }

    async refreshOpenModals() {
        const followersModal = document.getElementById('followersModal');
        const followingModal = document.getElementById('followingModal');
        
        if (followersModal && followersModal.style.display === 'flex' && currentProfileUsername) {
            await showFollowersModal(currentProfileUsername);
        }
        
        if (followingModal && followingModal.style.display === 'flex' && currentProfileUsername) {
            await showFollowingModal(currentProfileUsername);
        }
    }

    debounce(func, wait) {
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

    // Apply debounce to profile updates
    debouncedProfileUpdate = this.debounce(() => {
        if (currentProfileUsername) {
            loadUserProfile(currentProfileUsername);
        }
    }, 500);

    // Existing post and comment handlers
    handleNewPost(post) {
        if (window.posts && Array.isArray(window.posts)) {
            const existingIndex = window.posts.findIndex(p => p._id === post._id);
            if (existingIndex === -1) {
                window.posts.unshift(post);
                
                if (document.getElementById('homePage').style.display !== 'none') {
                    this.renderNewPost(post);
                }
            }
        }
    }

    renderNewPost(post) {
        const postsList = document.getElementById('postsList');
        if (!postsList) return;

        const postHTML = this.createPostHTML(post);
        
        if (postsList.querySelector('.loading')) {
            postsList.innerHTML = postHTML;
        } else {
            postsList.insertAdjacentHTML('afterbegin', postHTML);
        }
    }

    handleUpdatedPost(updatedPost) {
        if (window.posts && Array.isArray(window.posts)) {
            const index = window.posts.findIndex(p => p._id === updatedPost._id);
            if (index !== -1) {
                window.posts[index] = updatedPost;
                this.updatePostInUI(updatedPost);
            }
        }
    }

    updatePostInUI(updatedPost) {
        const postElement = document.querySelector(`[data-post-id="${updatedPost._id}"]`);
        if (postElement) {
            const titleElement = postElement.querySelector('.post-title');
            const contentElement = postElement.querySelector('.post-text');
            const categoryElement = postElement.querySelector('.post-category');
            
            if (titleElement) titleElement.textContent = updatedPost.title;
            if (contentElement) {
                const needsReadMore = updatedPost.content.length > 300;
                const truncatedContent = needsReadMore ? updatedPost.content.substring(0, 300) + '...' : updatedPost.content;
                contentElement.textContent = truncatedContent;
                contentElement.classList.toggle('truncated', needsReadMore);
                
                const readMoreBtn = postElement.querySelector('.read-more-btn');
                if (readMoreBtn) {
                    readMoreBtn.style.display = needsReadMore ? 'flex' : 'none';
                }
            }
            if (categoryElement) categoryElement.textContent = updatedPost.category;
        }
    }

    handleDeletedPost(postId) {
        if (window.posts && Array.isArray(window.posts)) {
            window.posts = window.posts.filter(p => p._id !== postId);
            this.removePostFromUI(postId);
        }
    }

    removePostFromUI(postId) {
        const postElement = document.querySelector(`[data-post-id="${postId}"]`);
        if (postElement) {
            postElement.style.opacity = '0.5';
            setTimeout(() => {
                postElement.remove();
            }, 500);
        }
    }

    handlePostLikeUpdate(postId, userId, liked, likeCount) {
    console.log('WebSocket: Post like update', { postId, userId, liked, likeCount, currentUser: currentUser?._id });
    
    // Update post in feed
    const postElement = document.querySelector(`[data-post-id="${postId}"]`);
    if (postElement) {
        const likeBtn = postElement.querySelector('.action-btn:nth-child(1)');
        const likeCountSpan = likeBtn?.querySelector('span');
        
        if (likeBtn && likeCountSpan) {
            likeCountSpan.textContent = likeCount;
            
            // Update like state for current user
            if (userId === currentUser?._id) {
                if (liked) {
                    likeBtn.classList.add('liked');
                } else {
                    likeBtn.classList.remove('liked');
                }
            }
        }
    }
    
    // ALSO update post detail page if it's the current post
    if (currentPostId === postId) {
        this.updatePostDetailLikeUI(userId, liked, likeCount);
    }
}

// Improved method to update post detail like UI
updatePostDetailLikeUI(userId, liked, likeCount) {
    // Update like button in post actions
    const likeBtn = document.querySelector('.post-detail-actions .action-btn:nth-child(1)');
    const likeCountSpan = likeBtn?.querySelector('span');
    
    if (likeBtn && likeCountSpan) {
        likeCountSpan.textContent = likeCount;
        
        // Update like state for current user
        if (userId === currentUser?._id) {
            if (liked) {
                likeBtn.classList.add('liked');
            } else {
                likeBtn.classList.remove('liked');
            }
        }
    }
    
    // Update like count in post stats
    const likeStat = document.querySelector('.post-stats .stat:nth-child(2) span');
    if (likeStat) {
        likeStat.textContent = likeCount + ' likes';
    }
}


    // In the RealTimeClient class, update the handleNewComment method:
handleNewComment(postId, comment) {
    const commentsList = document.getElementById(`comments-list-${postId}`);
    if (commentsList) {
        const existingComment = commentsList.querySelector(`[data-comment-id="${comment._id}"]`);
        if (!existingComment) {
            const commentHTML = this.createCommentHTML(comment, postId);
            commentsList.insertAdjacentHTML('beforeend', commentHTML);
            this.updateCommentCount(postId, 1);
        }
    }
    
    // ALSO update post detail page if open
    if (currentPostId === postId) {
        const postDetailCommentsList = document.getElementById('postDetailCommentsList');
        if (postDetailCommentsList) {
            const existingComment = postDetailCommentsList.querySelector(`[data-comment-id="${comment._id}"]`);
            if (!existingComment) {
                // Reload all comments to maintain order
                loadPostDetailComments();
                this.updatePostDetailCommentCount(1);
            }
        }
    }
}

// Similarly update handleCommentDeleted, handleReplyAdded, etc. to refresh the post detail comments

// In the RealTimeClient class, update the handleCommentLikeUpdate method:
handleCommentLikeUpdate(postId, commentId, userId, liked, likeCount) {
    console.log('WebSocket: Comment like update', { postId, commentId, userId, liked, likeCount, currentUser: currentUser?._id });
    
    // Update ALL comment elements with this ID (both in feed and post detail)
    const commentElements = document.querySelectorAll(`[data-comment-id="${commentId}"]`);
    
    commentElements.forEach(commentElement => {
        const likeBtn = commentElement.querySelector('.comment-action-btn:first-child');
        const likeCountSpan = likeBtn?.querySelector('span');
        
        if (likeBtn && likeCountSpan) {
            likeCountSpan.textContent = likeCount;
            
            // Update like state for current user
            if (userId === currentUser?._id) {
                if (liked) {
                    likeBtn.classList.add('liked');
                } else {
                    likeBtn.classList.remove('liked');
                }
            }
        }
    });
}

    handleNewNotification(notification) {
        if (window.notifications && Array.isArray(window.notifications)) {
            const existingIndex = window.notifications.findIndex(n => n._id === notification._id);
            if (existingIndex === -1) {
                window.notifications.unshift(notification);
                window.unreadNotificationCount = (window.unreadNotificationCount || 0) + 1;
                updateUI();
            }
        }
    }

    handleUserTyping(postId, userId, username, typing) {
        const typingIndicator = document.getElementById(`typing-${postId}`) || 
                            this.createTypingIndicator(postId);
        
        if (typing) {
            typingIndicator.style.display = 'block';
            typingIndicator.innerHTML = `${username} is typing...`;
            
            clearTimeout(typingIndicator.timeout);
            typingIndicator.timeout = setTimeout(() => {
                typingIndicator.style.display = 'none';
            }, 3000);
        } else {
            typingIndicator.style.display = 'none';
        }
    }

    createTypingIndicator(postId) {
        const indicator = document.createElement('div');
        indicator.id = `typing-${postId}`;
        indicator.className = 'typing-indicator';
        indicator.style.cssText = `
            font-style: italic;
            color: var(--secondary-color);
            font-size: 12px;
            padding: 8px 12px;
            display: none;
        `;
        
        const commentsSection = document.getElementById(`comments-${postId}`);
        if (commentsSection) {
            commentsSection.insertBefore(indicator, commentsSection.firstChild);
        }
        
        return indicator;
    }

    createPostHTML(post) {
    const needsReadMore = post.content.length > 300;
    const truncatedContent = needsReadMore ? post.content.substring(0, 300) + '...' : post.content;
    
    // Check if current user has liked this post - FIXED VERSION
    const isLikedByCurrentUser = post.likes && (
        Array.isArray(post.likes) 
            ? post.likes.some(like => 
                (like._id && like._id === currentUser?._id) || 
                (like === currentUser?._id) ||
                (typeof like === 'string' && like === currentUser?._id)
            )
            : false
    );

    return `
    <div class="post" data-post-id="${post._id}" data-full-content="${this.encodeHTML(post.content)}">
        <div class="post-header">
            <div class="post-user-info">
                <div class="avatar" style="background: ${JSON.parse(post.author.avatar).color}; cursor: pointer;" onclick="showProfilePage('${post.author.username}')">
                    ${JSON.parse(post.author.avatar).initials}
                </div>
                <div class="post-meta">
                    <div class="post-author" onclick="showProfilePage('${post.author.username}')" style="cursor: pointer;">
                        ${post.author.name}
                    </div>
                    <div class="post-username">@${post.author.username}</div>
                    <div class="post-time">${getTimeAgo(post.createdAt)}</div>
                </div>
            </div>
            <div class="post-category">${post.category}</div>
        </div>
        <div class="post-content">
            <h3 class="post-title" onclick="showPostPage('${post._id}')" style="cursor: pointer;">${post.title}</h3>
            <div class="post-text ${needsReadMore ? 'truncated' : ''}" id="post-text-${post._id}">
                ${needsReadMore ? truncatedContent : post.content}
            </div>
            ${needsReadMore ? `
                <button class="read-more-btn" onclick="toggleReadMore('${post._id}')" id="read-more-${post._id}">
                    <span>Read More</span>
                    <i class="fas fa-chevron-down"></i>
                </button>
            ` : ''}
            ${post.tags && post.tags.length > 0 ? `
                <div class="post-tags">
                    ${post.tags.map(tag => `<span class="tag">#${tag}</span>`).join('')}
                </div>
            ` : ''}
        </div>
        <div class="post-actions">
            <button class="action-btn ${isLikedByCurrentUser ? 'liked' : ''}" 
                    onclick="likePost('${post._id}')">
                <i class="fas fa-heart"></i>
                <span>${post.likes.length}</span>
            </button>
            <button class="action-btn" onclick="toggleComments('${post._id}')">
                <i class="fas fa-comment"></i>
                <span>${post.comments.length}</span>
            </button>
            <button class="action-btn" onclick="showSharePostModal('${post._id}')">
                <i class="fas fa-share"></i>
                <span>Share</span>
            </button>
            ${currentUser && currentUser._id === post.author._id ? `
                <button class="action-btn" onclick="editPost('${post._id}')">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="action-btn text-error" onclick="deletePost('${post._id}')">
                    <i class="fas fa-trash"></i>
                </button>
            ` : ''}
        </div>
        <div class="comments-section" id="comments-${post._id}" style="display: none;">
            <div class="comment-form">
                <textarea placeholder="Add a comment..." id="comment-${post._id}" class="form-input form-textarea" rows="3" oninput="handleCommentTyping('${post._id}', 'new-comment')"></textarea>
                <button class="btn btn-primary mt-2" onclick="addComment('${post._id}')">Post Comment</button>
            </div>
            <div class="comments-list mt-4" id="comments-list-${post._id}">
                ${this.renderComments(post.comments, post._id)}
            </div>
        </div>
    </div>
    `;
}
    createCommentHTML(comment, postId) {
    // Consistent like state detection
    const isCommentLiked = comment.likes && Array.isArray(comment.likes) && 
        comment.likes.some(like => 
            (like._id && like._id === currentUser?._id) || 
            (like === currentUser?._id) ||
            (typeof like === 'string' && like === currentUser?._id)
        );
    
    const canDeleteComment = currentUser && (currentUser._id === comment.author._id || currentUser._id === comment.author);
    
    return `
    <div class="comment" data-comment-id="${comment._id}">
        <div class="flex items-start gap-3">
            <div class="avatar small" style="background: ${JSON.parse(comment.author.avatar).color}; cursor: pointer;" onclick="showProfilePage('${comment.author.username}')">
                ${JSON.parse(comment.author.avatar).initials}
            </div>
            <div class="flex-1">
                <div class="flex items-center gap-2">
                    <div class="font-semibold" style="cursor: pointer;" onclick="showProfilePage('${comment.author.username}')">${comment.author.name}</div>
                    <div class="text-xs text-secondary">${getTimeAgo(comment.createdAt)}</div>
                </div>
                <div class="text-sm mt-1">${comment.content}</div>
                
                <div class="comment-actions mt-2 flex items-center gap-4">
                    <button class="comment-action-btn ${isCommentLiked ? 'liked' : ''}" onclick="likeComment('${postId}', '${comment._id}')">
                        <i class="fas fa-heart"></i>
                        <span>${comment.likes ? comment.likes.length : 0}</span>
                    </button>
                    <button class="comment-action-btn" onclick="toggleReplyForm('${comment._id}')">
                        <i class="fas fa-reply"></i>
                        <span>Reply</span>
                    </button>
                    ${canDeleteComment ? `
                    <button class="comment-action-btn text-error" onclick="deleteComment('${postId}', '${comment._id}')">
                        <i class="fas fa-trash"></i>
                        <span>Delete</span>
                    </button>
                    ` : ''}
                </div>

                <div class="reply-form mt-3 hidden" id="reply-form-${comment._id}">
                    <textarea 
                        class="form-input form-textarea" 
                        id="reply-input-${comment._id}" 
                        placeholder="Write a reply..."
                        rows="2"
                        maxlength="500"
                        oninput="handleCommentTyping('${postId}', '${comment._id}')"
                    ></textarea>
                    <div class="flex justify-between items-center mt-2">
                        <div class="text-xs text-secondary" id="reply-char-count-${comment._id}">0/500</div>
                        <div class="flex gap-2">
                            <button class="btn btn-outline btn-sm" onclick="toggleReplyForm('${comment._id}')">Cancel</button>
                            <button class="btn btn-primary btn-sm" onclick="addReply('${postId}', '${comment._id}')">Post Reply</button>
                        </div>
                    </div>
                </div>

                ${comment.replies && comment.replies.length > 0 ? `
                    <div class="replies mt-4 ml-6 border-l-2 pl-4" style="border-color: var(--border-color);">
                        ${comment.replies.map(reply => this.createReplyHTML(reply, postId, comment._id)).join('')}
                    </div>
                ` : ''}
            </div>
        </div>
    </div>
    `;
}
    // In the createReplyHTML method, ensure it has:
createReplyHTML(reply, postId, commentId) {
    // Consistent like state detection for replies
    const isReplyLiked = reply.likes && (
        Array.isArray(reply.likes) 
            ? reply.likes.some(like => 
                (like._id && like._id === currentUser?._id) || 
                (like === currentUser?._id) ||
                (typeof like === 'string' && like === currentUser?._id)
            )
            : false
    );
    
    const canDeleteReply = currentUser && (currentUser._id === reply.author._id || currentUser._id === reply.author);
    
    return `
    <div class="reply mb-3" data-reply-id="${reply._id}">
        <div class="flex items-start gap-3">
            <div class="avatar small" style="background: ${JSON.parse(reply.author.avatar).color}; cursor: pointer;" onclick="showProfilePage('${reply.author.username}')">
                ${JSON.parse(reply.author.avatar).initials}
            </div>
            <div class="flex-1">
                <div class="flex items-center gap-2">
                    <div class="font-semibold text-sm" style="cursor: pointer;" onclick="showProfilePage('${reply.author.username}')">${reply.author.name}</div>
                    <div class="text-xs text-secondary">${getTimeAgo(reply.createdAt)}</div>
                </div>
                <div class="text-sm mt-1">${reply.content}</div>
                <div class="reply-actions mt-1 flex items-center gap-4">
                    <button class="comment-action-btn ${isReplyLiked ? 'liked' : ''}" onclick="likeReply('${postId}', '${commentId}', '${reply._id}')">
                        <i class="fas fa-heart"></i>
                        <span>${reply.likes ? reply.likes.length : 0}</span>
                    </button>
                    ${canDeleteReply ? `
                    <button class="comment-action-btn text-error text-xs" onclick="deleteReply('${postId}', '${commentId}', '${reply._id}')">
                        <i class="fas fa-trash"></i>
                        <span>Delete</span>
                    </button>
                    ` : ''}
                </div>
            </div>
        </div>
    </div>
    `;
}

    renderComments(comments, postId) {
        if (!comments || comments.length === 0) {
            return '<div class="text-center text-secondary p-4">No comments yet</div>';
        }
        
        return comments.map(comment => this.createCommentHTML(comment, postId)).join('');
    }

    updateCommentCount(postId, change) {
        const commentBtn = document.querySelector(`[data-post-id="${postId}"] .action-btn:nth-child(2) span`);
        if (commentBtn) {
            const currentCount = parseInt(commentBtn.textContent) || 0;
            commentBtn.textContent = currentCount + change;
        }
    }

    showToast(message, type, duration = 3000) {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <div class="toast-content">
                <i class="fas fa-${type === 'success' ? 'check' : type === 'error' ? 'exclamation-triangle' : 'info'}"></i>
                <span>${message}</span>
            </div>
        `;
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.classList.add('show');
        }, 100);
        
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                if (toast.parentElement) {
                    toast.remove();
                }
            }, 300);
        }, duration);
    }

    encodeHTML(str) {
        return str.replace(/[&<>"']/g, 
            match => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            }[match]));
    }

    attemptReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
            
            setTimeout(() => {
                if (!this.isConnected) {
                    this.connect();
                }
            }, delay);
        }
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
                this.ws.send(JSON.stringify(data));
            } catch (error) {
                console.error('WebSocket send error:', error);
            }
        }
    }

    startTyping(postId) {
        this.send({
            type: 'typing_start',
            postId: postId
        });
    }

    stopTyping(postId) {
        this.send({
            type: 'typing_stop',
            postId: postId
        });
    }

    disconnect() {
        if (this.ws) {
            this.ws.close(1000, 'User initiated disconnect');
        }
        this.isConnected = false;
    }
}

let realTimeClient = new RealTimeClient();

// Initialize the application
async function initApp() {
    try {
        console.log('🌐 Initializing Oracs Application...');
        console.log('📍 Production Environment: https://www.oracs.in');
        
        // Load user likes from localStorage
        const storedLikes = localStorage.getItem('userLikes');
        if (storedLikes) {
            userLikes = JSON.parse(storedLikes);
        }
        
        await checkAuth();
        updatePostsContainer();
        await loadPosts();
        await loadTrending();
        
        if (currentUser) {
            await loadNotifications();
            await loadFeedRecommendations();
            setupNotificationPolling();
            realTimeClient.connect();
        }
        
        setupEventListeners();
        setupGlobalEventListeners();
        
        // Check for post ID in URL hash
        const hash = window.location.hash;
        if (hash.startsWith('#/post/')) {
            const postId = hash.split('/')[2];
            showPostPage(postId);
        }

        console.log('✅ Oracs Application Initialized Successfully');
    } catch (error) {
        console.error('❌ App initialization failed:', error);
        realTimeClient.showToast('Application initialization failed. Please refresh the page.', 'error');
    }
}
// Authentication functions
async function checkAuth() {
    const token = localStorage.getItem('token');
    
    if (!token) {
        updateUI();
        return;
    }

    try {
        const data = await api.get('/auth/me');
        if (data.success) {
            currentUser = data.user;
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
        }
    } catch (error) {
        console.error('Auth check failed:', error);
        localStorage.removeItem('token');
        localStorage.removeItem('currentUser');
        currentUser = null;
        if (realTimeClient) {
            realTimeClient.disconnect();
        }
    } finally {
        updateUI();
    }
}

function updateUI() {
    if (currentUser) {
        userActions.innerHTML = `
            <div class="notification-container">
                <button class="btn btn-ghost" id="notificationBtn" onclick="toggleNotifications(event)">
                    <i class="fas fa-bell"></i>
                    ${unreadNotificationCount > 0 ? 
                        `<span class="notification-badge">${unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}</span>` : 
                        ''}
                </button>
                <div class="notification-dropdown" id="notificationDropdown">
                    <div class="notification-header">
                        <h3 style="margin: 0; font-size: 16px;">Notifications</h3>
                        <button class="btn btn-ghost btn-sm" onclick="markAllNotificationsAsRead()" style="font-size: 12px;">
                            Mark all as read
                        </button>
                    </div>
                    <div class="notification-list" id="notificationList">
                        ${notifications.length === 0 ? 
                            '<div class="text-center py-4 text-secondary">No notifications</div>' : 
                            ''}
                    </div>
                    <div class="notification-footer">
                        <a href="#" onclick="showAllNotifications(); return false;">View all notifications</a>
                    </div>
                </div>
            </div>
            <div class="user-info" onclick="showProfilePage('${currentUser.username}')" style="cursor: pointer;">
                <div class="user-avatar">${getInitials(currentUser.name)}</div>
                <span>${currentUser.name}</span>
            </div>
            <button class="btn btn-ghost" onclick="logout()">Log Out</button>
        `;
        
        renderNotificationDropdown(notifications);
        createPostContainer.classList.remove('hidden');
        updatePostsContainer();
        
    } else {
        userActions.innerHTML = `
            <button class="btn btn-outline" onclick="showLoginModal()">Log In</button>
            <button class="btn btn-primary" onclick="showSignupModal()">Sign Up</button>
        `;
        createPostContainer.classList.add('hidden');
        updatePostsContainer();
    }
}

// Post Page Functions
async function showPostPage(postId) {
    homePage.style.display = 'none';
    profilePage.style.display = 'none';
    notificationsPage.style.display = 'none';
    postPage.style.display = 'block';
    
    currentPostId = postId;
    await loadPostDetail(postId);
    await loadPostDetailTrending();
    
    window.history.pushState({}, '', `#/post/${postId}`);
}

async function loadPostDetail(postId) {
    try {
        const data = await api.get(`/posts/${postId}`);
        
        if (data.success) {
            renderPostDetail(data.post);
        }
    } catch (error) {
        console.error('Failed to load post detail:', error);
        document.getElementById('postDetailContent').innerHTML = `
            <div class="card text-center p-8">
                <i class="fas fa-exclamation-triangle text-error text-4xl mb-4"></i>
                <h3 class="text-lg font-semibold mb-2">Error loading post</h3>
                <p class="text-secondary mb-4">${error.message || 'Please try again later'}</p>
                <button class="btn btn-primary" onclick="showHomePage()">Back to Home</button>
            </div>
        `;
    }
}
// Update the renderPostDetail function to ensure proper data attributes and classes
function renderPostDetail(post) {
    const postDetailContent = document.getElementById('postDetailContent');
    const postPageActions = document.getElementById('postPageActions');
    
    // Format content with line breaks
    const formattedContent = post.content.replace(/\n/g, '<br>');
    
    // Check if current user has liked this post - FIXED VERSION
    const isLikedByCurrentUser = post.likes && (
        Array.isArray(post.likes) 
            ? post.likes.some(like => 
                (like._id && like._id === currentUser?._id) || 
                (like === currentUser?._id) ||
                (typeof like === 'string' && like === currentUser?._id)
            )
            : false
    );
    
    postDetailContent.innerHTML = `
        <div class="card" data-post-id="${post._id}">
            <div class="post-header">
                <div class="post-user-info">
                    <div class="avatar" style="background: ${JSON.parse(post.author.avatar).color}; cursor: pointer;" onclick="showProfilePage('${post.author.username}')">
                        ${JSON.parse(post.author.avatar).initials}
                    </div>
                    <div class="post-meta">
                        <div class="post-author" onclick="showProfilePage('${post.author.username}')" style="cursor: pointer;">
                            ${post.author.name}
                        </div>
                        <div class="post-username">@${post.author.username}</div>
                        <div class="post-time">${getTimeAgo(post.createdAt)}</div>
                    </div>
                </div>
                <div class="post-category">${post.category}</div>
            </div>
            
            <div class="post-content">
                <h1 class="post-detail-title">${post.title}</h1>
                <div class="post-detail-text">${formattedContent}</div>
                
                ${post.tags && post.tags.length > 0 ? `
                    <div class="post-tags">
                        ${post.tags.map(tag => `<span class="tag">#${tag}</span>`).join('')}
                    </div>
                ` : ''}
                
                <div class="post-stats">
                    <div class="stat">
                        <i class="fas fa-eye"></i>
                        <span>${post.views || 0} views</span>
                    </div>
                    <div class="stat">
                        <i class="fas fa-heart"></i>
                        <span>${post.likes.length} likes</span>
                    </div>
                    <div class="stat">
                        <i class="fas fa-comment"></i>
                        <span>${post.comments.length} comments</span>
                    </div>
                    ${post.repostCount > 0 ? `
                        <div class="stat">
                            <i class="fas fa-retweet"></i>
                            <span>${post.repostCount} reposts</span>
                        </div>
                    ` : ''}
                </div>
            </div>
            
            <div class="post-actions post-detail-actions">
                <button class="action-btn ${isLikedByCurrentUser ? 'liked' : ''}" 
                        onclick="likePost('${post._id}')">
                    <i class="fas fa-heart"></i>
                    <span>${post.likes.length}</span>
                </button>
                <button class="action-btn" onclick="focusCommentInput()">
                    <i class="fas fa-comment"></i>
                    <span>${post.comments.length}</span>
                </button>
                <button class="action-btn" onclick="showSharePostModal('${post._id}')">
                    <i class="fas fa-share"></i>
                    <span>Share</span>
                </button>
                ${currentUser && currentUser._id === post.author._id ? `
                    <button class="action-btn" onclick="editPost('${post._id}')">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="action-btn text-error" onclick="deletePost('${post._id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                ` : ''}
            </div>
        </div>
        
        <!-- Comments Section -->
        <div class="card mt-6" id="postDetailCommentsSection">
            <div class="card-header">
                <h3 class="card-title">
                    <i class="fas fa-comments"></i>
                    Comments (<span id="postDetailCommentsCount">${post.comments.length}</span>)
                </h3>
            </div>
            <div class="card-body">
                <!-- Comment Form -->
                ${currentUser ? `
                    <div class="comment-form mb-6">
                        <textarea 
                            class="form-input form-textarea" 
                            id="postDetailCommentInput" 
                            placeholder="Add your comment..." 
                            rows="3"
                            maxlength="1000"
                            oninput="handlePostDetailCommentTyping()"
                        ></textarea>
                        <div class="flex justify-between items-center mt-2">
                            <div class="text-xs text-secondary" id="postDetailCommentCharCount">0/1000</div>
                            <button class="btn btn-primary" onclick="addCommentFromPostPage()">
                                Post Comment
                            </button>
                        </div>
                    </div>
                ` : `
                    <div class="alert alert-info mb-6">
                        <i class="fas fa-info-circle"></i>
                        <a href="#" onclick="showLoginModal()" class="text-primary">Log in</a> to add a comment
                    </div>
                `}
                
                <!-- Comments List -->
                <div class="comments-list" id="postDetailCommentsList">
                    ${post.comments && post.comments.length > 0 ? 
                        renderPostDetailCommentsList(post.comments) : 
                        `
                        <div class="text-center text-secondary py-8">
                            <i class="fas fa-comments text-4xl mb-4"></i>
                            <p>No comments yet. Be the first to comment!</p>
                        </div>
                        `
                    }
                </div>
            </div>
        </div>
    `;
    
    // Update page actions
    postPageActions.innerHTML = `
        <button class="btn btn-outline" onclick="showSharePostModal('${post._id}')">
            <i class="fas fa-share"></i> Share
        </button>
        ${currentUser && currentUser._id === post.author._id ? `
            <button class="btn btn-outline" onclick="editPost('${post._id}')">
                <i class="fas fa-edit"></i> Edit
            </button>
        ` : ''}
    `;
    
    // Setup comment functionality
    setupPostDetailCommentFunctionality();
}
function renderPostDetailCommentsList(comments) {
    return comments.map(comment => {
        // FIXED: Use consistent like state detection
        const isCommentLiked = comment.likes && (
            Array.isArray(comment.likes) 
                ? comment.likes.some(like => 
                    (like._id && like._id === currentUser?._id) || 
                    (like === currentUser?._id) ||
                    (typeof like === 'string' && like === currentUser?._id)
                )
                : false
        );
        
        return `
        <div class="comment mb-6 pb-6 border-b border-gray-200" data-comment-id="${comment._id}">
            <div class="flex items-start gap-3">
                <div class="avatar small" style="background: ${JSON.parse(comment.author.avatar).color}; cursor: pointer;" onclick="showProfilePage('${comment.author.username}')">
                    ${JSON.parse(comment.author.avatar).initials}
                </div>
                <div class="flex-1">
                    <div class="flex items-center gap-2">
                        <div class="font-semibold" style="cursor: pointer;" onclick="showProfilePage('${comment.author.username}')">${comment.author.name}</div>
                        <div class="text-xs text-secondary">${getTimeAgo(comment.createdAt)}</div>
                    </div>
                    <div class="text-sm mt-1">${comment.content}</div>
                    
                    <div class="comment-actions mt-2 flex items-center gap-4">
                        <button class="comment-action-btn ${isCommentLiked ? 'liked' : ''}" onclick="likeComment('${currentPostId}', '${comment._id}')">
                            <i class="fas fa-heart"></i>
                            <span>${comment.likes ? comment.likes.length : 0}</span>
                        </button>
                        <button class="comment-action-btn" onclick="togglePostDetailReplyForm('${comment._id}')">
                            <i class="fas fa-reply"></i>
                            <span>Reply</span>
                        </button>
                        ${currentUser && (currentUser._id === comment.author._id || currentUser._id === comment.author) ? `
                        <button class="comment-action-btn text-error" onclick="deleteComment('${currentPostId}', '${comment._id}')">
                            <i class="fas fa-trash"></i>
                            <span>Delete</span>
                        </button>
                        ` : ''}
                    </div>

                    <div class="reply-form mt-3 hidden" id="post-detail-reply-form-${comment._id}">
                        <textarea 
                            class="form-input form-textarea" 
                            id="post-detail-reply-input-${comment._id}" 
                            placeholder="Write a reply..."
                            rows="2"
                            maxlength="500"
                            oninput="handlePostDetailReplyTyping('${comment._id}')"
                        ></textarea>
                        <div class="flex justify-between items-center mt-2">
                            <div class="text-xs text-secondary" id="post-detail-reply-char-count-${comment._id}">0/500</div>
                            <div class="flex gap-2">
                                <button class="btn btn-outline btn-sm" onclick="togglePostDetailReplyForm('${comment._id}')">Cancel</button>
                                <button class="btn btn-primary btn-sm" onclick="addPostDetailReply('${comment._id}')">Post Reply</button>
                            </div>
                        </div>
                    </div>

                    ${comment.replies && comment.replies.length > 0 ? `
                        <div class="replies mt-4 ml-6 border-l-2 pl-4" style="border-color: var(--border-color);">
                            ${comment.replies.map(reply => createPostDetailReplyHTML(reply, comment._id)).join('')}
                        </div>
                    ` : ''}
                </div>
            </div>
        </div>
        `;
    }).join('');
}

function createPostDetailReplyHTML(reply, commentId) {
    const isReplyLiked = reply.likes && reply.likes.some(like => like._id === currentUser?._id);
    const canDeleteReply = currentUser && (currentUser._id === reply.author._id || currentUser._id === reply.author);
    
    return `
    <div class="reply mb-3" data-reply-id="${reply._id}">
        <div class="flex items-start gap-3">
            <div class="avatar small" style="background: ${JSON.parse(reply.author.avatar).color}; cursor: pointer;" onclick="showProfilePage('${reply.author.username}')">
                ${JSON.parse(reply.author.avatar).initials}
            </div>
            <div class="flex-1">
                <div class="flex items-center gap-2">
                    <div class="font-semibold text-sm" style="cursor: pointer;" onclick="showProfilePage('${reply.author.username}')">${reply.author.name}</div>
                    <div class="text-xs text-secondary">${getTimeAgo(reply.createdAt)}</div>
                </div>
                <div class="text-sm mt-1">${reply.content}</div>
                <div class="reply-actions mt-1 flex items-center gap-4">
                    <button class="comment-action-btn ${isReplyLiked ? 'liked' : ''}" onclick="likeReply('${currentPostId}', '${commentId}', '${reply._id}')">
                        <i class="fas fa-heart"></i>
                        <span>${reply.likes ? reply.likes.length : 0}</span>
                    </button>
                    ${canDeleteReply ? `
                    <button class="comment-action-btn text-error text-xs" onclick="deleteReply('${currentPostId}', '${commentId}', '${reply._id}')">
                        <i class="fas fa-trash"></i>
                        <span>Delete</span>
                    </button>
                    ` : ''}
                </div>
            </div>
        </div>
    </div>
    `;
}

function setupPostDetailCommentFunctionality() {
    // Setup character counter for main comment input
    const commentInput = document.getElementById('postDetailCommentInput');
    const charCount = document.getElementById('postDetailCommentCharCount');
    
    if (commentInput && charCount) {
        commentInput.addEventListener('input', function() {
            const length = this.value.length;
            charCount.textContent = `${length}/1000`;
            
            if (length > 1000) {
                charCount.classList.add('text-error');
            } else {
                charCount.classList.remove('text-error');
            }
        });
    }
    
    // Setup reply functionality for existing comments
    setupPostDetailReplyFunctionality();
}

function setupPostDetailReplyFunctionality() {
    // This will be called when new comments are added via real-time updates
    document.querySelectorAll('.reply-form textarea').forEach(textarea => {
        const commentId = textarea.id.replace('post-detail-reply-input-', '');
        const counter = document.getElementById(`post-detail-reply-char-count-${commentId}`);
        
        if (textarea && counter) {
            textarea.addEventListener('input', function() {
                const length = this.value.length;
                counter.textContent = `${length}/500`;
                
                if (length > 500) {
                    counter.classList.add('text-error');
                } else {
                    counter.classList.remove('text-error');
                }
            });
        }
    });
}

// Make sure to add these supporting functions if they don't exist:

function togglePostDetailReplyForm(commentId) {
    const replyForm = document.getElementById(`post-detail-reply-form-${commentId}`);
    if (replyForm) {
        replyForm.classList.toggle('hidden');
        
        if (!replyForm.classList.contains('hidden')) {
            const textarea = document.getElementById(`post-detail-reply-input-${commentId}`);
            if (textarea) {
                textarea.focus();
            }
        }
    }
}

function handlePostDetailCommentTyping() {
    if (realTimeClient && realTimeClient.isConnected) {
        realTimeClient.startTyping(currentPostId);
        
        if (typingTimeouts[currentPostId]) {
            clearTimeout(typingTimeouts[currentPostId]);
        }
        
        typingTimeouts[currentPostId] = setTimeout(() => {
            if (realTimeClient) {
                realTimeClient.stopTyping(currentPostId);
            }
        }, 2000);
    }
    
    // Update character count
    const textarea = document.getElementById('postDetailCommentInput');
    const counter = document.getElementById('postDetailCommentCharCount');
    
    if (textarea && counter) {
        const length = textarea.value.length;
        counter.textContent = `${length}/1000`;
        
        if (length > 1000) {
            counter.classList.add('text-error');
        } else {
            counter.classList.remove('text-error');
        }
    }
}

function handlePostDetailReplyTyping(commentId) {
    if (realTimeClient && realTimeClient.isConnected) {
        realTimeClient.startTyping(currentPostId);
        
        if (typingTimeouts[currentPostId]) {
            clearTimeout(typingTimeouts[currentPostId]);
        }
        
        typingTimeouts[currentPostId] = setTimeout(() => {
            if (realTimeClient) {
                realTimeClient.stopTyping(currentPostId);
            }
        }, 2000);
    }
    
    // Update character count
    const textarea = document.getElementById(`post-detail-reply-input-${commentId}`);
    const counter = document.getElementById(`post-detail-reply-char-count-${commentId}`);
    
    if (textarea && counter) {
        const length = textarea.value.length;
        counter.textContent = `${length}/500`;
        
        if (length > 500) {
            counter.classList.add('text-error');
        } else {
            counter.classList.remove('text-error');
        }
    }
}



// Share Functionality
function showSharePostModal(postId) {
    currentPostId = postId;
    showModal('sharePostModal');
}

function getPostUrl(postId) {
    return `${window.location.origin}${window.location.pathname}#/post/${postId}`;
}

async function copyPostLink() {
    if (!currentPostId) return;
    
    const postUrl = getPostUrl(currentPostId);
    
    try {
        await navigator.clipboard.writeText(postUrl);
        realTimeClient.showToast('Post link copied to clipboard!', 'success');
        closeModal(document.getElementById('sharePostModal'));
    } catch (error) {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = postUrl;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        realTimeClient.showToast('Post link copied to clipboard!', 'success');
        closeModal(document.getElementById('sharePostModal'));
    }
}

function shareOnTwitter() {
    if (!currentPostId) return;
    
    const postUrl = getPostUrl(currentPostId);
    const text = encodeURIComponent('Check out this research post on ThereIn!');
    const url = encodeURIComponent(postUrl);
    
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, '_blank', 'width=600,height=400');
    closeModal(document.getElementById('sharePostModal'));
}

function shareOnLinkedIn() {
    if (!currentPostId) return;
    
    const postUrl = getPostUrl(currentPostId);
    const url = encodeURIComponent(postUrl);
    
    window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${url}`, '_blank', 'width=600,height=400');
    closeModal(document.getElementById('sharePostModal'));
}

function shareOnFacebook() {
    if (!currentPostId) return;
    
    const postUrl = getPostUrl(currentPostId);
    const url = encodeURIComponent(postUrl);
    
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, '_blank', 'width=600,height=400');
    closeModal(document.getElementById('sharePostModal'));
}

function shareViaEmail() {
    if (!currentPostId) return;
    
    const postUrl = getPostUrl(currentPostId);
    const subject = encodeURIComponent('Interesting research post from ThereIn');
    const body = encodeURIComponent(`I found this research post interesting and wanted to share it with you:\n\n${postUrl}`);
    
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
    closeModal(document.getElementById('sharePostModal'));
}

// Update the existing showHomePage function to handle URL routing
const originalShowHomePage = showHomePage;
showHomePage = function() {
    originalShowHomePage();
    postPage.style.display = 'none';
    window.history.pushState({}, '', window.location.pathname);
};

// Handle browser back/forward buttons
window.addEventListener('popstate', function(event) {
    const hash = window.location.hash;
    if (hash.startsWith('#/post/')) {
        const postId = hash.split('/')[2];
        showPostPage(postId);
    } else {
        showHomePage();
    }
});

// Update posts container to include feed filters
function updatePostsContainer() {
    const postsContainer = document.querySelector('.posts-container');
    const existingFilters = document.getElementById('feedFilters');
    if (existingFilters) {
        existingFilters.remove();
    }
    
    const feedFiltersHTML = `
        <div class="card mb-4" id="feedFilters">
            <div class="feed-filters">
                <div class="feed-tabs">
                    <button class="feed-tab ${currentFeed === 'all' ? 'active' : ''}" onclick="switchFeed('all')">
                        <i class="fas fa-globe"></i>
                        All Posts
                    </button>
                    ${currentUser ? `
                        <button class="feed-tab ${currentFeed === 'following' ? 'active' : ''}" onclick="switchFeed('following')">
                            <i class="fas fa-user-friends"></i>
                            Following
                        </button>
                        <button class="feed-tab ${currentFeed === 'my-posts' ? 'active' : ''}" onclick="switchFeed('my-posts')">
                            <i class="fas fa-user"></i>
                            My Posts
                        </button>
                    ` : ''}
                    <button class="feed-tab ${currentFeed === 'trending' ? 'active' : ''}" onclick="switchFeed('trending')">
                        <i class="fas fa-fire"></i>
                        Trending
                    </button>
                </div>
                
                <div class="feed-sort">
                    <select class="form-select form-select-sm" id="sortSelect" onchange="switchSort(this.value)">
                        <option value="hot" ${currentSort === 'hot' ? 'selected' : ''}>Hot</option>
                        <option value="new" ${currentSort === 'new' ? 'selected' : ''}>Newest</option>
                        <option value="old" ${currentSort === 'old' ? 'selected' : ''}>Oldest</option>
                        <option value="top" ${currentSort === 'top' ? 'selected' : ''}>Top</option>
                        <option value="trending" ${currentSort === 'trending' ? 'selected' : ''}>Trending</option>
                    </select>
                </div>
            </div>
            
            ${currentFeed === 'following' && !currentUser ? `
                <div class="alert alert-info mt-3">
                    <i class="fas fa-info-circle"></i>
                    <a href="#" onclick="showLoginModal()">Log in</a> to see posts from users you follow
                </div>
            ` : ''}
        </div>
    `;
    
    const createPostContainer = document.getElementById('createPostContainer');
    if (createPostContainer) {
        createPostContainer.insertAdjacentHTML('afterend', feedFiltersHTML);
    }
}

// Switch feed type
async function switchFeed(feedType) {
    if ((feedType === 'following' || feedType === 'my-posts') && !currentUser) {
        showLoginModal();
        return;
    }
    
    currentFeed = feedType;
    await loadPosts();
    updateFeedFiltersUI();
}

// Switch sort type
async function switchSort(sortType) {
    currentSort = sortType;
    await loadPosts();
}

// Update feed filters UI based on current state
function updateFeedFiltersUI() {
    const feedFilters = document.getElementById('feedFilters');
    if (!feedFilters) return;
    
    document.querySelectorAll('.feed-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    const activeTab = document.querySelector(`.feed-tab[onclick="switchFeed('${currentFeed}')"]`);
    if (activeTab) {
        activeTab.classList.add('active');
    }
    
    const sortSelect = document.getElementById('sortSelect');
    if (sortSelect) {
        sortSelect.value = currentSort;
    }
}

// Enhanced loadPosts function with feed and sort support
async function loadPosts(searchQuery = '') {
    try {
        postsList.innerHTML = '<div class="loading"><i class="fas fa-spinner loading-spinner"></i><div>Loading posts...</div></div>';
        
        const params = new URLSearchParams();
        
        if (searchQuery) {
            params.append('search', searchQuery);
        } else {
            params.append('feed', currentFeed);
            params.append('sortBy', currentSort);
        }
        
        params.append('page', '1');
        params.append('limit', '20');
        
        const endpoint = `/posts?${params.toString()}`;
        const data = await api.get(endpoint);
        
        if (data.success) {
            posts = data.posts;
            renderPosts();
            updateFeedInfo(data);
        }
    } catch (error) {
        console.error('Failed to load posts:', error);
        postsList.innerHTML = `
            <div class="card text-center p-8">
                <i class="fas fa-exclamation-triangle text-error text-4xl mb-4"></i>
                <h3 class="text-lg font-semibold mb-2">Error loading posts</h3>
                <p class="text-secondary">${error.message || 'Please try again later'}</p>
                <button class="btn btn-primary mt-4" onclick="loadPosts()">Retry</button>
            </div>
        `;
    }
}

// Update feed information display
function updateFeedInfo(data) {
    const feedFilters = document.getElementById('feedFilters');
    if (!feedFilters) return;
    
    const existingInfo = document.getElementById('feedInfo');
    if (existingInfo) {
        existingInfo.remove();
    }
    
    let feedDescription = '';
    let feedIcon = '';
    
    switch (currentFeed) {
        case 'all':
            feedDescription = 'Showing all public research posts';
            feedIcon = 'fas fa-globe';
            break;
        case 'following':
            feedDescription = `Posts from users you follow • ${data.breakdown?.fromFollowing || 0} posts`;
            feedIcon = 'fas fa-user-friends';
            break;
        case 'my-posts':
            feedDescription = 'Your research posts';
            feedIcon = 'fas fa-user';
            break;
        case 'trending':
            feedDescription = 'Trending research in the past week';
            feedIcon = 'fas fa-fire';
            break;
    }
    
    const feedInfoHTML = `
        <div class="feed-info" id="feedInfo">
            <div class="flex items-center gap-2 text-sm text-secondary">
                <i class="${feedIcon}"></i>
                <span>${feedDescription}</span>
                ${data.total ? `<span class="font-semibold">• ${data.total} posts</span>` : ''}
            </div>
        </div>
    `;
    
    feedFilters.insertAdjacentHTML('beforeend', feedInfoHTML);
}

// Enhanced search function that resets to 'all' feed
// Enhanced search function that supports u: prefix for user search
async function handleSearch(e) {
    const query = e.target.value.trim();
    
    if (query.length > 2) {
        // Check if it's a user search (starts with u:)
        if (query.startsWith('u:')) {
            const username = query.slice(2).trim();
            if (username.length > 0) {
                await searchUsers(username);
                return;
            }
        }
        
        // Regular post search
        if (currentFeed !== 'all') {
            currentFeed = 'all';
            updateFeedFiltersUI();
        }
        await loadPosts(query);
    } else if (query.length === 0) {
        // Reset to normal posts when search is cleared
        await loadPosts();
        hideUserSearchResults();
    }
}

// Function to search users
async function searchUsers(username) {
    try {
        const data = await api.get(`/users/search?username=${encodeURIComponent(username)}`);
        
        if (data.success && data.users && data.users.length > 0) {
            showUserSearchResults(data.users, username);
        } else {
            showUserSearchResults([], username);
        }
    } catch (error) {
        console.error('User search error:', error);
        showUserSearchResults([], username);
    }
}

// Function to display user search results
function showUserSearchResults(users, searchQuery) {
    const postsList = document.getElementById('postsList');
    
    if (users.length === 0) {
        postsList.innerHTML = `
            <div class="card text-center p-8">
                <i class="fas fa-user-slash text-4xl text-secondary mb-4"></i>
                <h3 class="text-lg font-semibold mb-2">No users found</h3>
                <p class="text-secondary">No users found matching "${searchQuery}"</p>
            </div>
        `;
        return;
    }

    postsList.innerHTML = `
        <div class="card mb-4">
            <div class="card-header">
                <h3 class="card-title">
                    <i class="fas fa-users text-primary"></i>
                    Users matching "${searchQuery}"
                </h3>
            </div>
            <div class="space-y-3 p-4">
                ${users.map(user => createUserSearchResultHTML(user)).join('')}
            </div>
        </div>
    `;
}

// Function to create HTML for user search results
function createUserSearchResultHTML(user) {
    const avatar = JSON.parse(user.avatar);
    
    return `
        <div class="user-search-result flex items-center gap-4 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
             onclick="showProfilePage('${user.username}')">
            <div class="avatar medium" style="background: ${avatar.color}">
                ${avatar.initials}
            </div>
            <div class="flex-1">
                <div class="font-semibold">${user.name}</div>
                <div class="text-secondary">@${user.username}</div>
                ${user.field ? `<div class="text-sm text-secondary mt-1">${user.field}</div>` : ''}
                ${user.bio ? `<div class="text-sm mt-2 line-clamp-2">${user.bio}</div>` : ''}
            </div>
            <div class="user-stats text-sm text-secondary text-right">
                <div class="font-semibold">${user.stats?.postsCount || 0}</div>
                <div>posts</div>
            </div>
            <i class="fas fa-chevron-right text-secondary"></i>
        </div>
    `;
}

// Function to hide user search results and show normal posts
function hideUserSearchResults() {
    // This will be handled by loadPosts() when called with empty query
}

// Add CSS for user search results
const userSearchStyles = `
    .user-search-result {
        transition: all 0.2s ease;
    }
    
    .user-search-result:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }
    
    .avatar.medium {
        width: 60px;
        height: 60px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-weight: bold;
        font-size: 1.25rem;
        flex-shrink: 0;
    }
`;

// Inject the styles
const styleSheet = document.createElement('style');
styleSheet.textContent = userSearchStyles;
document.head.appendChild(styleSheet);

// Load personalized feed recommendations
async function loadFeedRecommendations() {
    if (!currentUser) return;
    
    try {
        const data = await api.get('/posts/feed/recommendations');
        
        if (data.success && data.posts.length > 0) {
            updateRecommendationsSidebar(data);
        }
    } catch (error) {
        console.error('Failed to load feed recommendations:', error);
    }
}

// Update sidebar with recommendations
function updateRecommendationsSidebar(data) {
    const existingRecommendations = document.getElementById('recommendationsSection');
    if (existingRecommendations) {
        existingRecommendations.remove();
    }
    
    const recommendationsHTML = `
        <div class="card" id="recommendationsSection">
            <div class="card-header">
                <h3 class="card-title">
                    <i class="fas fa-lightbulb text-primary"></i>
                    Recommended for You
                </h3>
            </div>
            <div class="space-y-3">
                ${data.posts.slice(0, 5).map(post => `
                    <div class="recommended-post" onclick="showPostPage('${post._id}')" style="cursor: pointer;">
                        <div class="text-sm font-semibold line-clamp-2">${post.title}</div>
                        <div class="text-xs text-secondary mt-1">
                            by ${post.author.name} • ${getTimeAgo(post.createdAt)}
                        </div>
                        <div class="text-xs text-secondary mt-1">
                            <i class="fas fa-heart"></i> ${post.likesCount || post.likes.length} 
                            <i class="fas fa-comment ml-2"></i> ${post.commentsCount || post.comments.length}
                        </div>
                    </div>
                `).join('')}
            </div>
            ${data.breakdown ? `
                <div class="mt-3 pt-3 border-t text-xs text-secondary">
                    <div class="flex justify-between">
                        <span>From following:</span>
                        <span>${data.breakdown.fromFollowing}</span>
                    </div>
                    <div class="flex justify-between">
                        <span>From your field:</span>
                        <span>${data.breakdown.fromField}</span>
                    </div>
                    <div class="flex justify-between">
                        <span>Similar interests:</span>
                        <span>${data.breakdown.similarInterests}</span>
                    </div>
                </div>
            ` : ''}
        </div>
    `;
    
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
        const trendingCard = document.querySelector('.card:first-child');
        if (trendingCard) {
            trendingCard.insertAdjacentHTML('afterend', recommendationsHTML);
        }
    }
}

// Render posts function
function renderPosts() {
    if (posts.length === 0) {
        let emptyMessage = 'No posts found. Be the first to share research!';
        
        switch (currentFeed) {
            case 'following':
                emptyMessage = 'No posts from users you follow. Start following some researchers to see their posts here!';
                break;
            case 'my-posts':
                emptyMessage = 'You haven\'t created any posts yet. Share your first research!';
                break;
            case 'trending':
                emptyMessage = 'No trending posts at the moment. Check back later!';
                break;
        }
        
        postsList.innerHTML = `<div class="card text-center p-8"><p>${emptyMessage}</p></div>`;
        return;
    }

    postsList.innerHTML = posts.map(post => realTimeClient.createPostHTML(post)).join('');
}

// Load trending posts for post detail sidebar
async function loadPostDetailTrending() {
    try {
        const data = await api.get('/posts/trending/all');
        
        if (data.success && data.posts && data.posts.length > 0) {
            document.getElementById('postDetailTrending').innerHTML = data.posts.map(post => {
                const likesCount = post.likesCount || (post.likes ? post.likes.length : 0);
                const commentsCount = post.commentsCount || (post.comments ? post.comments.length : 0);
                
                return `
                    <div class="trending-post-item" onclick="showPostPage('${post._id}')">
                        <div class="trending-post-title">${post.title}</div>
                        <div class="trending-post-meta">${likesCount} likes • ${commentsCount} comments</div>
                    </div>
                `;
            }).join('');
        } else {
            document.getElementById('postDetailTrending').innerHTML = '<div class="text-sm text-secondary p-4 text-center">No trending posts</div>';
        }
    } catch (error) {
        console.error('Failed to load post detail trending:', error);
        document.getElementById('postDetailTrending').innerHTML = '<div class="text-sm text-secondary p-4 text-center">Error loading trending</div>';
    }
}

// Enhanced Notification Functions
async function loadNotifications() {
    if (!currentUser) return;
    
    try {
        const data = await api.get('/notifications');
        if (data.success) {
            notifications = data.notifications;
            unreadNotificationCount = data.unreadCount || 0;
            updateUI();
        }
    } catch (error) {
        console.error('Failed to load notifications:', error);
    }
}

// Mark all notifications as read
async function markAllNotificationsAsRead() {
    if (!currentUser) return;
    
    try {
        const data = await api.patch('/notifications/read-all');
        if (data.success) {
            // Update local state
            notifications.forEach(notification => {
                notification.read = true;
            });
            unreadNotificationCount = 0;
            
            // Update UI
            updateUI();
            if (realTimeClient) {
                realTimeClient.showToast('All notifications marked as read', 'success');
            }
            
            // Refresh notifications page if open
            if (document.getElementById('notificationsContent')) {
                renderNotificationsPage(notifications);
            }
        }
    } catch (error) {
        console.error('Mark all as read error:', error);
        if (realTimeClient) {
            realTimeClient.showToast('Failed to mark notifications as read', 'error');
        }
    }
}

// Clear all notifications
async function clearAllNotifications() {
    if (!currentUser) return;
    
    if (!confirm('Are you sure you want to clear all notifications? This action cannot be undone.')) {
        return;
    }
    
    try {
        const data = await api.delete('/notifications');
        if (data.success) {
            // Update local state
            notifications = [];
            unreadNotificationCount = 0;
            
            // Update UI
            updateUI();
            if (document.getElementById('notificationsContent')) {
                renderNotificationsPage([]);
            }
            if (realTimeClient) {
                realTimeClient.showToast('All notifications cleared', 'success');
            }
        }
    } catch (error) {
        console.error('Clear notifications error:', error);
        if (realTimeClient) {
            realTimeClient.showToast('Failed to clear notifications', 'error');
        }
    }
}

// Handle notification click
async function handleNotificationClick(notificationId) {
    try {
        // Mark notification as read
        const data = await api.patch(`/notifications/${notificationId}/read`);
        if (data.success) {
            // Update local state
            const notification = notifications.find(n => n._id === notificationId);
            if (notification && !notification.read) {
                notification.read = true;
                unreadNotificationCount = Math.max(0, unreadNotificationCount - 1);
                updateUI();
            }
            
            // Navigate to the relevant content
            const notificationObj = notifications.find(n => n._id === notificationId);
            if (notificationObj) {
                if (notificationObj.post) {
                    showPostPage(notificationObj.post._id || notificationObj.post);
                } else if (notificationObj.comment) {
                    // If it's a comment notification, show the post and scroll to comment
                    const postData = await api.get(`/posts/${notificationObj.post}`);
                    if (postData.success) {
                        showPostPage(notificationObj.post);
                        // Scroll to comment after a short delay to allow page load
                        setTimeout(() => {
                            const commentElement = document.querySelector(`[data-comment-id="${notificationObj.comment}"]`);
                            if (commentElement) {
                                commentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                commentElement.style.backgroundColor = 'var(--highlight-color)';
                                setTimeout(() => {
                                    commentElement.style.backgroundColor = '';
                                }, 2000);
                            }
                        }, 1000);
                    }
                } else {
                    // If it's a follow notification, show the user's profile
                    if (notificationObj.fromUser) {
                        const userData = await api.get(`/users/${notificationObj.fromUser._id || notificationObj.fromUser}`);
                        if (userData.success) {
                            showProfilePage(userData.user.username);
                        }
                    }
                }
            }
            
            // Close dropdown if open
            const dropdown = document.getElementById('notificationDropdown');
            if (dropdown) {
                dropdown.classList.remove('show');
            }
        }
    } catch (error) {
        console.error('Handle notification click error:', error);
        // Even if marking as read fails, still try to navigate
        const notificationObj = notifications.find(n => n._id === notificationId);
        if (notificationObj && notificationObj.post) {
            showPostPage(notificationObj.post._id || notificationObj.post);
        }
    }
}

// Delete single notification
async function deleteNotification(notificationId) {
    try {
        const data = await api.delete(`/notifications/${notificationId}`);
        if (data.success) {
            // Update local state
            const notificationIndex = notifications.findIndex(n => n._id === notificationId);
            if (notificationIndex !== -1) {
                const wasUnread = !notifications[notificationIndex].read;
                notifications.splice(notificationIndex, 1);
                
                if (wasUnread) {
                    unreadNotificationCount = Math.max(0, unreadNotificationCount - 1);
                }
                
                // Update UI
                updateUI();
                
                // Refresh notifications page if open
                if (document.getElementById('notificationsContent')) {
                    renderNotificationsPage(notifications);
                }
                
                if (realTimeClient) {
                    realTimeClient.showToast('Notification deleted', 'success');
                }
            }
        }
    } catch (error) {
        console.error('Delete notification error:', error);
        if (realTimeClient) {
            realTimeClient.showToast('Failed to delete notification', 'error');
        }
    }
}

function setupNotificationPolling() {
    setInterval(async () => {
        if (currentUser) {
            await loadNotifications();
        }
    }, 30000);
}

function toggleNotifications(event) {
    if (event) event.stopPropagation();
    const dropdown = document.getElementById('notificationDropdown');
    if (dropdown) {
        dropdown.classList.toggle('show');
    }
}

function renderNotificationDropdown(notifications) {
    const notificationList = document.getElementById('notificationList');
    
    if (!notifications || notifications.length === 0) {
        notificationList.innerHTML = '<div class="text-center py-4 text-secondary">No notifications</div>';
        return;
    }

    notificationList.innerHTML = notifications.slice(0, 5).map(notification => {
        const timeAgo = getTimeAgo(notification.createdAt);
        const isUnread = !notification.read;
        
        return `
            <div class="notification-item-dropdown ${isUnread ? 'unread' : ''}" 
                 data-id="${notification._id}" 
                 onclick="handleNotificationClick('${notification._id}')">
                <div class="notification-message-dropdown">
                    ${notification.message || 'You have a new notification'}
                </div>
                <div class="notification-time-dropdown">${timeAgo}</div>
            </div>
        `;
    }).join('');
}

// Fixed Notification Functions
async function showAllNotifications() {
    console.log('showAllNotifications called');
    
    // Hide all pages first
    homePage.style.display = 'none';
    profilePage.style.display = 'none';
    notificationsPage.style.display = 'block';
    postPage.style.display = 'none';
    
    // Close notification dropdown if open
    const dropdown = document.getElementById('notificationDropdown');
    if (dropdown) {
        dropdown.classList.remove('show');
    }
    
    await loadNotificationsPage();
}

async function loadNotificationsPage() {
    try {
        console.log('Loading notifications page...');
        const data = await api.get('/notifications');
        
        if (data.success) {
            console.log('Notifications loaded:', data.notifications.length);
            renderNotificationsPage(data.notifications);
        } else {
            console.error('Failed to load notifications:', data);
            showNotificationsError();
        }
    } catch (error) {
        console.error('Failed to load notifications page:', error);
        showNotificationsError();
    }
}

function showNotificationsError() {
    const container = document.getElementById('notificationsContent');
    if (container) {
        container.innerHTML = `
            <div class="text-center text-error p-8">
                <i class="fas fa-exclamation-triangle text-4xl mb-4"></i>
                <h3 class="text-lg font-semibold mb-2">Error loading notifications</h3>
                <p class="text-secondary mb-4">Please try again later</p>
                <button class="btn btn-primary" onclick="loadNotificationsPage()">Retry</button>
            </div>
        `;
    }
}

function renderNotificationsPage(notifications) {
    const container = document.getElementById('notificationsContent');
    if (!container) {
        console.error('Notifications container not found');
        return;
    }
    
    if (!notifications || notifications.length === 0) {
        container.innerHTML = `
            <div class="notification-empty text-center py-12">
                <i class="fas fa-bell-slash text-4xl text-secondary mb-4"></i>
                <h3 class="text-lg font-semibold mb-2">No notifications yet</h3>
                <p class="text-secondary">When you get notifications, they'll appear here.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = notifications.map(notification => {
        const timeAgo = getTimeAgo(notification.createdAt);
        const isUnread = !notification.read;
        
        // Determine notification type and icon
        let icon = 'fas fa-bell';
        let colorClass = 'text-primary';
        
        if (notification.type === 'like') {
            icon = 'fas fa-heart';
            colorClass = 'text-error';
        } else if (notification.type === 'comment') {
            icon = 'fas fa-comment';
            colorClass = 'text-info';
        } else if (notification.type === 'follow') {
            icon = 'fas fa-user-plus';
            colorClass = 'text-success';
        }

        return `
            <div class="notification-item-page ${isUnread ? 'unread' : ''}" 
                 onclick="handleNotificationClick('${notification._id}')"
                 style="cursor: pointer; padding: 16px; border-bottom: 1px solid var(--border-color); transition: background-color 0.2s ease;">
                <div class="notification-header-page" style="display: flex; justify-content: between; align-items: flex-start; gap: 12px;">
                    <div class="flex items-start gap-3 flex-1">
                        <div class="${colorClass}" style="font-size: 18px;">
                            <i class="${icon}"></i>
                        </div>
                        <div class="flex-1">
                            <div class="notification-message-page" style="font-weight: 500; margin-bottom: 4px;">
                                ${notification.message || 'You have a new notification'}
                            </div>
                            ${notification.post ? `
                                <div class="notification-post" style="background: var(--light-bg); padding: 8px 12px; border-radius: 6px; margin-top: 8px;">
                                    <i class="fas fa-file-alt text-secondary mr-2"></i>
                                    <span style="font-size: 14px; color: var(--secondary-color);">${notification.post.title}</span>
                                </div>
                            ` : ''}
                            <div class="notification-meta" style="display: flex; justify-content: between; align-items: center; margin-top: 8px;">
                                <div class="notification-time-page" style="font-size: 12px; color: var(--secondary-color);">
                                    ${timeAgo}
                                </div>
                                <div class="notification-actions">
                                    <button class="btn btn-ghost btn-sm" 
                                            onclick="event.stopPropagation(); deleteNotification('${notification._id}')"
                                            style="padding: 4px 8px; font-size: 12px;">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    ${isUnread ? `
                        <div class="unread-indicator" style="width: 8px; height: 8px; background: var(--primary-color); border-radius: 50%; flex-shrink: 0; margin-top: 8px;"></div>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

// Read More/Show Less functionality
function toggleReadMore(postId) {
    const postElement = document.querySelector(`[data-post-id="${postId}"]`);
    const textElement = document.getElementById(`post-text-${postId}`);
    const buttonElement = document.getElementById(`read-more-${postId}`);
    
    if (!postElement || !textElement || !buttonElement) return;

    const fullContent = decodeHTML(postElement.getAttribute('data-full-content'));
    const buttonText = buttonElement.querySelector('span');
    const buttonIcon = buttonElement.querySelector('i');
    const isExpanded = textElement.classList.contains('expanded');

    if (isExpanded) {
        textElement.textContent = fullContent.substring(0, 300) + '...';
        textElement.classList.add('truncated');
        textElement.classList.remove('expanded');
        buttonText.textContent = 'Read More';
        buttonElement.classList.remove('expanded');
        buttonIcon.style.transform = 'rotate(0deg)';
    } else {
        textElement.textContent = fullContent;
        textElement.classList.remove('truncated');
        textElement.classList.add('expanded');
        buttonText.textContent = 'Show Less';
        buttonElement.classList.add('expanded');
        buttonIcon.style.transform = 'rotate(180deg)';
    }
}

function decodeHTML(str) {
    const textArea = document.createElement('textarea');
    textArea.innerHTML = str;
    return textArea.value;
}

// Enhanced Comment functions with delete, reply, and like - UPDATED FOR REAL-TIME
async function addComment(postId) {
    if (!currentUser) {
        showLoginModal();
        return;
    }

    const commentInput = document.getElementById(`comment-${postId}`);
    const content = commentInput.value.trim();

    if (!content) {
        realTimeClient.showToast('Please enter a comment', 'error');
        return;
    }

    if (content.length > 1000) {
        realTimeClient.showToast('Comment cannot be more than 1000 characters', 'error');
        return;
    }

    if (realTimeClient) {
        realTimeClient.stopTyping(postId);
    }

    try {
        const data = await api.post(`/posts/${postId}/comments`, { content });
        
        if (data.success) {
            commentInput.value = '';
            realTimeClient.showToast('Comment added successfully', 'success');
        }
    } catch (error) {
        console.error('Add comment error:', error);
        realTimeClient.showToast(error.message || 'Failed to add comment', 'error');
    }
}

// Delete comment - UPDATED FOR REAL-TIME
async function deleteComment(postId, commentId) {
    if (!currentUser) {
        showLoginModal();
        return;
    }

    if (!confirm('Are you sure you want to delete this comment?')) {
        return;
    }

    try {
        const data = await api.delete(`/posts/${postId}/comments/${commentId}`);
        
        if (data.success) {
            // The actual removal will be handled by the WebSocket event
            // We don't need to manually remove it here
            realTimeClient.showToast('Comment deleted successfully', 'success');
        }
    } catch (error) {
        console.error('Delete comment error:', error);
        realTimeClient.showToast(error.message || 'Failed to delete comment', 'error');
    }
}

// Delete reply - UPDATED FOR REAL-TIME
async function deleteReply(postId, commentId, replyId) {
    if (!currentUser) {
        showLoginModal();
        return;
    }

    if (!confirm('Are you sure you want to delete this reply?')) {
        return;
    }

    try {
        const data = await api.delete(`/posts/${postId}/comments/${commentId}/replies/${replyId}`);
        
        if (data.success) {
            // The actual removal will be handled by the WebSocket event
            realTimeClient.showToast('Reply deleted successfully', 'success');
        }
    } catch (error) {
        console.error('Delete reply error:', error);
        realTimeClient.showToast(error.message || 'Failed to delete reply', 'error');
    }
}

// Add reply to comment - UPDATED FOR REAL-TIME
async function addReply(postId, commentId) {
    if (!currentUser) {
        showLoginModal();
        return;
    }

    const replyInput = document.getElementById(`reply-input-${commentId}`);
    const content = replyInput.value.trim();

    if (!content) {
        realTimeClient.showToast('Please enter a reply', 'error');
        return;
    }

    if (content.length > 500) {
        realTimeClient.showToast('Reply cannot be more than 500 characters', 'error');
        return;
    }

    if (realTimeClient) {
        realTimeClient.stopTyping(postId);
    }

    try {
        const data = await api.post(`/posts/${postId}/comments/${commentId}/replies`, { content });
        
        if (data.success) {
            // The actual addition will be handled by the WebSocket event
            // Just clear the input and show success message
            replyInput.value = '';
            toggleReplyForm(commentId);
            realTimeClient.showToast('Reply added successfully', 'success');
        }
    } catch (error) {
        console.error('Add reply error:', error);
        realTimeClient.showToast(error.message || 'Failed to add reply', 'error');
    }
}

async function likeComment(postId, commentId) {
    if (!currentUser) {
        showLoginModal();
        return;
    }

    // Find ALL comment elements with this ID (both in feed and post detail)
    const commentElements = document.querySelectorAll(`[data-comment-id="${commentId}"]`);
    
    if (commentElements.length === 0) {
        console.error('No comment elements found for commentId:', commentId);
        return;
    }

    let likeBtns = [];
    let likeCountSpans = [];
    let currentLikedStates = [];
    let currentCounts = [];
    
    // Collect all like buttons and their current state
    commentElements.forEach(commentElement => {
        const likeBtn = commentElement.querySelector('.comment-action-btn:first-child');
        const likeCountSpan = likeBtn?.querySelector('span');
        
        if (likeBtn && likeCountSpan) {
            likeBtns.push(likeBtn);
            likeCountSpans.push(likeCountSpan);
            currentLikedStates.push(likeBtn.classList.contains('liked'));
            currentCounts.push(parseInt(likeCountSpan.textContent) || 0);
        }
    });

    if (likeBtns.length === 0) {
        console.error('No like buttons found for comment:', commentId);
        return;
    }

    // Determine the new state based on the first button's current state
    const currentLiked = currentLikedStates[0];
    const newLikedState = !currentLiked;
    
    // Optimistic update for all found comment elements
    likeBtns.forEach((likeBtn, index) => {
        const currentCount = currentCounts[index];
        
        if (currentLiked) {
            // Optimistically unlike
            likeBtn.classList.remove('liked');
            likeCountSpans[index].textContent = Math.max(0, currentCount - 1);
        } else {
            // Optimistically like
            likeBtn.classList.add('liked');
            likeCountSpans[index].textContent = currentCount + 1;
        }
        
        likeBtn.disabled = true;
    });

    try {
        const response = await api.post(`/posts/${postId}/comments/${commentId}/like`);
        
        if (response.success) {
            // Success - the WebSocket will handle the final state update
            console.log('Comment like API call successful');
        } else {
            throw new Error(response.message || 'Like action failed');
        }
    } catch (error) {
        console.error('Like comment error:', error);
        
        // Revert optimistic update on error
        likeBtns.forEach((likeBtn, index) => {
            const originalLiked = currentLikedStates[index];
            const originalCount = currentCounts[index];
            
            if (originalLiked) {
                likeBtn.classList.add('liked');
            } else {
                likeBtn.classList.remove('liked');
            }
            likeCountSpans[index].textContent = originalCount;
        });
        
        if (realTimeClient) {
            realTimeClient.showToast('Failed to like comment', 'error');
        }
    } finally {
        // Re-enable buttons
        likeBtns.forEach(likeBtn => {
            if (likeBtn) likeBtn.disabled = false;
        });
    }
}

async function likeReply(postId, commentId, replyId) {
    if (!currentUser) {
        showLoginModal();
        return;
    }

    // Find ALL reply elements with this ID (both in feed and post detail)
    const replyElements = document.querySelectorAll(`[data-reply-id="${replyId}"]`);
    
    if (replyElements.length === 0) {
        console.error('No reply elements found for replyId:', replyId);
        return;
    }

    let likeBtns = [];
    let likeCountSpans = [];
    let currentLikedStates = [];
    let currentCounts = [];
    
    // Collect all like buttons and their current state
    replyElements.forEach(replyElement => {
        const likeBtn = replyElement.querySelector('.comment-action-btn:first-child');
        const likeCountSpan = likeBtn?.querySelector('span');
        
        if (likeBtn && likeCountSpan) {
            likeBtns.push(likeBtn);
            likeCountSpans.push(likeCountSpan);
            currentLikedStates.push(likeBtn.classList.contains('liked'));
            currentCounts.push(parseInt(likeCountSpan.textContent) || 0);
        }
    });

    if (likeBtns.length === 0) {
        console.error('No like buttons found for reply:', replyId);
        return;
    }

    // Determine the new state based on the first button's current state
    const currentLiked = currentLikedStates[0];
    const newLikedState = !currentLiked;
    
    // Optimistic update for all found reply elements
    likeBtns.forEach((likeBtn, index) => {
        const currentCount = currentCounts[index];
        
        if (currentLiked) {
            // Optimistically unlike
            likeBtn.classList.remove('liked');
            likeCountSpans[index].textContent = Math.max(0, currentCount - 1);
        } else {
            // Optimistically like
            likeBtn.classList.add('liked');
            likeCountSpans[index].textContent = currentCount + 1;
        }
        
        likeBtn.disabled = true;
    });

    try {
        const response = await api.post(`/posts/${postId}/comments/${commentId}/replies/${replyId}/like`);
        
        if (response.success) {
            // Success - the WebSocket will handle the final state update
            console.log('Reply like API call successful');
        } else {
            throw new Error(response.message || 'Like action failed');
        }
    } catch (error) {
        console.error('Like reply error:', error);
        
        // Revert optimistic update on error
        likeBtns.forEach((likeBtn, index) => {
            const originalLiked = currentLikedStates[index];
            const originalCount = currentCounts[index];
            
            if (originalLiked) {
                likeBtn.classList.add('liked');
            } else {
                likeBtn.classList.remove('liked');
            }
            likeCountSpans[index].textContent = originalCount;
        });
        
        if (realTimeClient) {
            realTimeClient.showToast('Failed to like reply', 'error');
        }
    } finally {
        // Re-enable buttons
        likeBtns.forEach(likeBtn => {
            if (likeBtn) likeBtn.disabled = false;
        });
    }
}
// Post Detail Comments Functions
function focusCommentInput() {
    const commentSection = document.getElementById('postDetailCommentsSection');
    const commentInput = document.getElementById('postDetailCommentInput');
    
    if (commentSection && commentInput) {
        commentSection.style.display = 'block';
        commentInput.focus();
        
        // Scroll to comments section
        commentSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

async function addCommentFromPostPage() {
    if (!currentUser) {
        showLoginModal();
        return;
    }

    const commentInput = document.getElementById('postDetailCommentInput');
    const content = commentInput.value.trim();

    if (!content) {
        realTimeClient.showToast('Please enter a comment', 'error');
        return;
    }

    if (content.length > 1000) {
        realTimeClient.showToast('Comment cannot be more than 1000 characters', 'error');
        return;
    }

    if (realTimeClient) {
        realTimeClient.stopTyping(currentPostId);
    }

    try {
        const data = await api.post(`/posts/${currentPostId}/comments`, { content });
        
        if (data.success) {
            commentInput.value = '';
            updatePostDetailCommentCharCount();
            realTimeClient.showToast('Comment added successfully', 'success');
            
            // Refresh comments
            await loadPostDetailComments();
        }
    } catch (error) {
        console.error('Add comment error:', error);
        realTimeClient.showToast(error.message || 'Failed to add comment', 'error');
    }
}

// In loadPostDetailComments function, ensure consistent data structure
async function loadPostDetailComments() {
    if (!currentPostId) return;

    try {
        const data = await api.get(`/posts/${currentPostId}/comments`);
        
        if (data.success) {
            // Ensure comments have consistent structure
            const normalizedComments = data.comments.map(comment => ({
                ...comment,
                likes: comment.likes || [],
                replies: comment.replies || []
            }));
            
            renderPostDetailComments(normalizedComments);
            updatePostDetailCommentsCount(normalizedComments.length);
        }
    } catch (error) {
        console.error('Load post detail comments error:', error);
        // Error handling remains the same
    }
}

function renderPostDetailComments(comments) {
    const commentsList = document.getElementById('postDetailCommentsList');
    
    if (!comments || comments.length === 0) {
        commentsList.innerHTML = `
            <div class="text-center text-secondary py-8">
                <i class="fas fa-comments text-4xl mb-4"></i>
                <p>No comments yet. Be the first to comment!</p>
            </div>
        `;
        return;
    }

    commentsList.innerHTML = comments.map(comment => createPostDetailCommentHTML(comment)).join('');
    setupReplyCharCounters();
}

function createPostDetailCommentHTML(comment) {
    // FIXED: Use consistent like state detection for comments
    const isCommentLiked = comment.likes && (
        Array.isArray(comment.likes) 
            ? comment.likes.some(like => 
                (like._id && like._id === currentUser?._id) || 
                (like === currentUser?._id) ||
                (typeof like === 'string' && like === currentUser?._id)
            )
            : false
    );
    
    const canDeleteComment = currentUser && (currentUser._id === comment.author._id || currentUser._id === comment.author);
    
    return `
    <div class="comment mb-6 pb-6 border-b border-gray-200" data-comment-id="${comment._id}">
        <div class="flex items-start gap-3">
            <div class="avatar small" style="background: ${JSON.parse(comment.author.avatar).color}; cursor: pointer;" onclick="showProfilePage('${comment.author.username}')">
                ${JSON.parse(comment.author.avatar).initials}
            </div>
            <div class="flex-1">
                <div class="flex items-center gap-2">
                    <div class="font-semibold" style="cursor: pointer;" onclick="showProfilePage('${comment.author.username}')">${comment.author.name}</div>
                    <div class="text-xs text-secondary">${getTimeAgo(comment.createdAt)}</div>
                </div>
                <div class="text-sm mt-1">${comment.content}</div>
                
                <div class="comment-actions mt-2 flex items-center gap-4">
                    <button class="comment-action-btn ${isCommentLiked ? 'liked' : ''}" onclick="likeComment('${currentPostId}', '${comment._id}')">
                        <i class="fas fa-heart"></i>
                        <span>${comment.likes ? comment.likes.length : 0}</span>
                    </button>
                    <button class="comment-action-btn" onclick="togglePostDetailReplyForm('${comment._id}')">
                        <i class="fas fa-reply"></i>
                        <span>Reply</span>
                    </button>
                    ${canDeleteComment ? `
                    <button class="comment-action-btn text-error" onclick="deleteComment('${currentPostId}', '${comment._id}')">
                        <i class="fas fa-trash"></i>
                        <span>Delete</span>
                    </button>
                    ` : ''}
                </div>

                <div class="reply-form mt-3 hidden" id="post-detail-reply-form-${comment._id}">
                    <textarea 
                        class="form-input form-textarea" 
                        id="post-detail-reply-input-${comment._id}" 
                        placeholder="Write a reply..."
                        rows="2"
                        maxlength="500"
                        oninput="handlePostDetailReplyTyping('${comment._id}')"
                    ></textarea>
                    <div class="flex justify-between items-center mt-2">
                        <div class="text-xs text-secondary" id="post-detail-reply-char-count-${comment._id}">0/500</div>
                        <div class="flex gap-2">
                            <button class="btn btn-outline btn-sm" onclick="togglePostDetailReplyForm('${comment._id}')">Cancel</button>
                            <button class="btn btn-primary btn-sm" onclick="addPostDetailReply('${comment._id}')">Post Reply</button>
                        </div>
                    </div>
                </div>

                ${comment.replies && comment.replies.length > 0 ? `
                    <div class="replies mt-4 ml-6 border-l-2 pl-4" style="border-color: var(--border-color);">
                        ${comment.replies.map(reply => createPostDetailReplyHTML(reply, comment._id)).join('')}
                    </div>
                ` : ''}
            </div>
        </div>
    </div>
    `;
}

function createPostDetailReplyHTML(reply, commentId) {
    // FIXED: Use consistent like state detection for replies
    const isReplyLiked = reply.likes && (
        Array.isArray(reply.likes) 
            ? reply.likes.some(like => 
                (like._id && like._id === currentUser?._id) || 
                (like === currentUser?._id) ||
                (typeof like === 'string' && like === currentUser?._id)
            )
            : false
    );
    
    const canDeleteReply = currentUser && (currentUser._id === reply.author._id || currentUser._id === reply.author);
    
    return `
    <div class="reply mb-3" data-reply-id="${reply._id}">
        <div class="flex items-start gap-3">
            <div class="avatar small" style="background: ${JSON.parse(reply.author.avatar).color}; cursor: pointer;" onclick="showProfilePage('${reply.author.username}')">
                ${JSON.parse(reply.author.avatar).initials}
            </div>
            <div class="flex-1">
                <div class="flex items-center gap-2">
                    <div class="font-semibold text-sm" style="cursor: pointer;" onclick="showProfilePage('${reply.author.username}')">${reply.author.name}</div>
                    <div class="text-xs text-secondary">${getTimeAgo(reply.createdAt)}</div>
                </div>
                <div class="text-sm mt-1">${reply.content}</div>
                <div class="reply-actions mt-1 flex items-center gap-4">
                    <button class="comment-action-btn ${isReplyLiked ? 'liked' : ''}" onclick="likeReply('${currentPostId}', '${commentId}', '${reply._id}')">
                        <i class="fas fa-heart"></i>
                        <span>${reply.likes ? reply.likes.length : 0}</span>
                    </button>
                    ${canDeleteReply ? `
                    <button class="comment-action-btn text-error text-xs" onclick="deleteReply('${currentPostId}', '${commentId}', '${reply._id}')">
                        <i class="fas fa-trash"></i>
                        <span>Delete</span>
                    </button>
                    ` : ''}
                </div>
            </div>
        </div>
    </div>
    `;
}
function togglePostDetailReplyForm(commentId) {
    const replyForm = document.getElementById(`post-detail-reply-form-${commentId}`);
    if (replyForm) {
        replyForm.classList.toggle('hidden');
        
        if (!replyForm.classList.contains('hidden')) {
            setTimeout(() => {
                setupPostDetailReplyCharCounter(commentId);
            }, 100);
        }
    }
}

function setupPostDetailReplyCharCounter(commentId) {
    const textarea = document.getElementById(`post-detail-reply-input-${commentId}`);
    const counter = document.getElementById(`post-detail-reply-char-count-${commentId}`);
    
    if (textarea && counter) {
        textarea.addEventListener('input', function() {
            const length = this.value.length;
            counter.textContent = `${length}/500`;
            
            if (length > 500) {
                counter.classList.add('text-error');
            } else {
                counter.classList.remove('text-error');
            }
        });
    }
}

async function addPostDetailReply(commentId) {
    if (!currentUser) {
        showLoginModal();
        return;
    }

    const replyInput = document.getElementById(`post-detail-reply-input-${commentId}`);
    const content = replyInput.value.trim();

    if (!content) {
        realTimeClient.showToast('Please enter a reply', 'error');
        return;
    }

    if (content.length > 500) {
        realTimeClient.showToast('Reply cannot be more than 500 characters', 'error');
        return;
    }

    if (realTimeClient) {
        realTimeClient.stopTyping(currentPostId);
    }

    try {
        const data = await api.post(`/posts/${currentPostId}/comments/${commentId}/replies`, { content });
        
        if (data.success) {
            replyInput.value = '';
            togglePostDetailReplyForm(commentId);
            realTimeClient.showToast('Reply added successfully', 'success');
            
            // Refresh comments
            await loadPostDetailComments();
        }
    } catch (error) {
        console.error('Add reply error:', error);
        realTimeClient.showToast(error.message || 'Failed to add reply', 'error');
    }
}

function handlePostDetailCommentTyping() {
    if (realTimeClient && realTimeClient.isConnected) {
        realTimeClient.startTyping(currentPostId);
        
        if (typingTimeouts[currentPostId]) {
            clearTimeout(typingTimeouts[currentPostId]);
        }
        
        typingTimeouts[currentPostId] = setTimeout(() => {
            if (realTimeClient) {
                realTimeClient.stopTyping(currentPostId);
            }
        }, 2000);
    }
    
    // Update character count
    const textarea = document.getElementById('postDetailCommentInput');
    const counter = document.getElementById('postDetailCommentCharCount');
    
    if (textarea && counter) {
        const length = textarea.value.length;
        counter.textContent = `${length}/1000`;
        
        if (length > 1000) {
            counter.classList.add('text-error');
        } else {
            counter.classList.remove('text-error');
        }
    }
}

function updatePostDetailCommentCharCount() {
    const textarea = document.getElementById('postDetailCommentInput');
    const counter = document.getElementById('postDetailCommentCharCount');
    
    if (textarea && counter) {
        counter.textContent = '0/1000';
        counter.classList.remove('text-error');
    }
}

function updatePostDetailCommentsCount(count) {
    const countElement = document.getElementById('postDetailCommentsCount');
    if (countElement) {
        countElement.textContent = count;
    }
    
    // Also update the comment count in the post stats
    const commentStat = document.querySelector('.post-stats .stat:nth-child(3) span');
    if (commentStat) {
        commentStat.textContent = count;
    }
    
    // Update the comment button count
    const commentBtn = document.querySelector('.post-detail-actions .action-btn:nth-child(2) span');
    if (commentBtn) {
        commentBtn.textContent = count;
    }
}


function toggleReplyForm(commentId) {
    const replyForm = document.getElementById(`reply-form-${commentId}`);
    if (replyForm) {
        replyForm.classList.toggle('hidden');
        
        if (!replyForm.classList.contains('hidden')) {
            setTimeout(() => {
                setupReplyCharCounter(commentId);
            }, 100);
        }
    }
}

function setupReplyCharCounters() {
    document.querySelectorAll('.reply-form textarea').forEach(textarea => {
        const commentId = textarea.id.replace('reply-input-', '');
        const counter = document.getElementById(`reply-char-count-${commentId}`);
        
        if (textarea && counter) {
            textarea.addEventListener('input', function() {
                const length = this.value.length;
                counter.textContent = `${length}/500`;
                
                if (length > 500) {
                    counter.classList.add('text-error');
                } else {
                    counter.classList.remove('text-error');
                }
            });
        }
    });
}

// Add character counter for reply forms
function setupReplyCharCounter(commentId) {
    const textarea = document.getElementById(`reply-input-${commentId}`);
    const counter = document.getElementById(`reply-char-count-${commentId}`);
    
    if (textarea && counter) {
        textarea.addEventListener('input', function() {
            const length = this.value.length;
            counter.textContent = `${length}/500`;
            
            if (length > 500) {
                counter.classList.add('text-error');
            } else {
                counter.classList.remove('text-error');
            }
        });
    }
}

async function likePost(postId) {
    if (!currentUser) {
        showLoginModal();
        return;
    }

    // Find all like buttons and their current state
    let likeBtns = [];
    let likeCountSpans = [];
    let currentLikedStates = [];
    let currentCounts = [];
    
    // Find like buttons in feed
    const feedLikeBtn = document.querySelector(`[data-post-id="${postId}"] .action-btn:nth-child(1)`);
    if (feedLikeBtn) {
        const feedLikeCountSpan = feedLikeBtn.querySelector('span');
        if (feedLikeCountSpan) {
            likeBtns.push(feedLikeBtn);
            likeCountSpans.push(feedLikeCountSpan);
            currentLikedStates.push(feedLikeBtn.classList.contains('liked'));
            currentCounts.push(parseInt(feedLikeCountSpan.textContent) || 0);
        }
    }
    
    // Find like button in post detail if we're on that page
    if (currentPostId === postId) {
        const postDetailLikeBtn = document.querySelector('.post-detail-actions .action-btn:nth-child(1)');
        if (postDetailLikeBtn) {
            const postDetailLikeCountSpan = postDetailLikeBtn.querySelector('span');
            if (postDetailLikeCountSpan) {
                likeBtns.push(postDetailLikeBtn);
                likeCountSpans.push(postDetailLikeCountSpan);
                currentLikedStates.push(postDetailLikeBtn.classList.contains('liked'));
                currentCounts.push(parseInt(postDetailLikeCountSpan.textContent) || 0);
            }
        }
    }

    // If no buttons found, return
    if (likeBtns.length === 0) return;

    // Determine the new state based on the first button's current state
    const currentLiked = currentLikedStates[0];
    const newLikedState = !currentLiked;
    
    // Update global like state
    if (!userLikes[postId]) {
        userLikes[postId] = newLikedState;
    } else {
        userLikes[postId] = newLikedState;
    }
    localStorage.setItem('userLikes', JSON.stringify(userLikes));
    
    // Optimistic update for all found buttons
    likeBtns.forEach((likeBtn, index) => {
        const currentCount = currentCounts[index];
        
        if (currentLiked) {
            // Optimistically unlike
            likeBtn.classList.remove('liked');
            likeCountSpans[index].textContent = Math.max(0, currentCount - 1);
        } else {
            // Optimistically like
            likeBtn.classList.add('liked');
            likeCountSpans[index].textContent = currentCount + 1;
        }
        
        likeBtn.disabled = true;
    });

    // Also update post stats if on detail page
    if (currentPostId === postId) {
        const likeStat = document.querySelector('.post-stats .stat:nth-child(2) span');
        if (likeStat) {
            const newCount = currentLiked ? Math.max(0, currentCounts[0] - 1) : currentCounts[0] + 1;
            likeStat.textContent = newCount + ' likes';
        }
    }

    try {
        await api.post(`/posts/${postId}/like`);
        
        // Success - the WebSocket will handle the final state update
        // We don't need to do anything here as the real-time update will correct any discrepancies
        
    } catch (error) {
        console.error('Like post error:', error);
        
        // Revert optimistic update on error
        likeBtns.forEach((likeBtn, index) => {
            const currentLiked = currentLikedStates[index];
            const currentCount = currentCounts[index];
            
            if (currentLiked) {
                likeBtn.classList.add('liked');
                likeCountSpans[index].textContent = currentCount;
            } else {
                likeBtn.classList.remove('liked');
                likeCountSpans[index].textContent = currentCount;
            }
        });
        
        // Also revert post stats if on detail page
        if (currentPostId === postId) {
            const likeStat = document.querySelector('.post-stats .stat:nth-child(2) span');
            if (likeStat) {
                likeStat.textContent = currentCounts[0] + ' likes';
            }
        }
        
        // Revert global state
        userLikes[postId] = currentLiked;
        localStorage.setItem('userLikes', JSON.stringify(userLikes));
        
        realTimeClient.showToast('Failed to like post', 'error');
    } finally {
        likeBtns.forEach(likeBtn => {
            if (likeBtn) likeBtn.disabled = false;
        });
    }
}


// Delete post
async function deletePost(postId) {
    const post = posts.find(p => p._id === postId);
    if (!post) {
        realTimeClient.showToast('Post not found', 'error');
        return;
    }

    if (!currentUser || currentUser._id !== post.author._id) {
        realTimeClient.showToast('You can only delete your own posts', 'error');
        return;
    }

    if (!confirm('Are you sure you want to delete this post? This action cannot be undone.')) {
        return;
    }

    try {
        const data = await api.delete(`/posts/${postId}`);
        
        if (data.success) {
            realTimeClient.showToast('Post deleted successfully', 'success');
            showHomePage();
        }
    } catch (error) {
        console.error('Delete post error:', error);
        realTimeClient.showToast(error.message || 'Failed to delete post', 'error');
    }
}

// Edit post
async function editPost(postId) {
    const post = posts.find(p => p._id === postId);
    if (!post) {
        realTimeClient.showToast('Post not found', 'error');
        return;
    }

    if (!currentUser || currentUser._id !== post.author._id) {
        realTimeClient.showToast('You can only edit your own posts', 'error');
        return;
    }

    try {
        document.getElementById('editPostId').value = post._id;
        document.getElementById('editPostTitle').value = post.title;
        document.getElementById('editPostContent').value = post.content;
        document.getElementById('editPostCategory').value = post.category;
        document.getElementById('editPostTags').value = post.tags ? post.tags.join(', ') : '';

        showModal('editPostModal');
    } catch (error) {
        console.error('Edit post error:', error);
        realTimeClient.showToast('Error loading post for editing', 'error');
    }
}

// Handle delete post from edit modal
async function handleDeletePostFromEdit() {
    const postId = document.getElementById('editPostId').value;
    
    if (!postId) {
        realTimeClient.showToast('No post selected for deletion', 'error');
        return;
    }

    if (!confirm('Are you sure you want to delete this post? This action cannot be undone.')) {
        return;
    }

    try {
        const data = await api.delete(`/posts/${postId}`);
        
        if (data.success) {
            closeModal(document.getElementById('editPostModal'));
            realTimeClient.showToast('Post deleted successfully', 'success');
            showHomePage();
        }
    } catch (error) {
        console.error('Delete post error:', error);
        realTimeClient.showToast(error.message || 'Failed to delete post', 'error');
    }
}

// Handle edit post form submission
async function handleEditPost(e) {
    e.preventDefault();
    
    const postId = document.getElementById('editPostId').value;
    const formData = {
        title: document.getElementById('editPostTitle').value.trim(),
        content: document.getElementById('editPostContent').value.trim(),
        category: document.getElementById('editPostCategory').value,
        tags: document.getElementById('editPostTags').value
    };

    let hasErrors = false;
    if (!formData.title) {
        document.getElementById('editPostTitleError').style.display = 'block';
        hasErrors = true;
    }
    if (!formData.category) {
        document.getElementById('editPostCategoryError').style.display = 'block';
        hasErrors = true;
    }
    if (!formData.content) {
        document.getElementById('editPostContentError').style.display = 'block';
        hasErrors = true;
    }

    if (hasErrors) return;

    try {
        const data = await api.put(`/posts/${postId}`, formData);
        
        if (data.success) {
            closeModal(document.getElementById('editPostModal'));
            realTimeClient.showToast('Post updated successfully!', 'success');
            
            // If we're on the post page, refresh it
            if (currentPostId === postId) {
                await loadPostDetail(postId);
            }
        }
    } catch (error) {
        console.error('Edit post error:', error);
        realTimeClient.showToast(error.message || 'Failed to update post', 'error');
    }
}

// Trending posts
async function loadTrending() {
    try {
        const data = await api.get('/posts/trending/all');
        
        if (data.success && data.posts && data.posts.length > 0) {
            trendingList.innerHTML = data.posts.map(post => {
                const likesCount = post.likesCount || (post.likes ? post.likes.length : 0);
                const commentsCount = post.commentsCount || (post.comments ? post.comments.length : 0);
                
                return `
                    <div class="post-trending-item" onclick="showPostPage('${post._id}')" 
                         style="cursor: pointer; padding: 8px 0; border-bottom: 1px solid var(--border-color);">
                        <div class="text-sm font-semibold">${post.title}</div>
                        <div class="text-xs text-secondary">${likesCount} likes • ${commentsCount} comments</div>
                    </div>
                `;
            }).join('');
        } else {
            trendingList.innerHTML = '<div class="text-sm text-secondary p-4 text-center">No trending posts</div>';
        }
    } catch (error) {
        console.error('Failed to load trending posts:', error);
        trendingList.innerHTML = '<div class="text-sm text-secondary p-4 text-center">Error loading trending</div>';
    }
}

// Profile functions
async function showProfilePage(username) {
    homePage.style.display = 'none';
    profilePage.style.display = 'block';
    notificationsPage.style.display = 'none';
    postPage.style.display = 'none';
    
    currentProfileUsername = username;
    await loadUserProfile(username);
}

async function loadUserProfile(username) {
    try {
        const data = await api.get(`/profile/${username}`);
        
        if (data.success) {
            currentProfile = data.profile;
            renderProfilePage(data.profile);
            await loadUserPosts(username);
            await loadUserInsights(username);
            
            if (currentUser && currentUser.username !== username) {
                await checkFollowStatus(username);
            }
        }
    } catch (error) {
        console.error('Load profile error:', error);
        realTimeClient.showToast('Error loading profile', 'error');
        showHomePage();
    }
}

async function checkFollowStatus(username) {
    try {
        const data = await api.get(`/follow/${username}/status`);
        if (data.success) {
            if (currentProfile) {
                currentProfile.isFollowing = data.isFollowing;
            }
            
            const followBtn = document.querySelector('.btn-follow, .btn-unfollow');
            if (followBtn) {
                followBtn.textContent = data.isFollowing ? 'Unfollow' : 'Follow';
                followBtn.className = data.isFollowing ? 'btn btn-unfollow' : 'btn btn-follow';
            }
        }
    } catch (error) {
        console.error('Check follow status error:', error);
    }
}

function renderProfilePage(profile) {
    const avatar = JSON.parse(profile.avatar);
    
    document.getElementById('profileHeaderContent').innerHTML = `
        <div class="profile-info">
            <div class="profile-avatar-large" style="background: ${avatar.color}">
                ${avatar.initials}
            </div>
            <div class="profile-details">
                <h1 class="profile-name">${profile.name}</h1>
                <div class="profile-username">@${profile.username}</div>
                <div class="profile-field">${profile.field || 'No field specified'}</div>
                <div class="profile-stats">
                    <div class="stat-item" onclick="showFollowersModal('${profile.username}')">
                        <span class="stat-number">${profile.stats.followerCount}</span>
                        <span class="stat-label">Followers</span>
                    </div>
                    <div class="stat-item" onclick="showFollowingModal('${profile.username}')">
                        <span class="stat-number">${profile.stats.followingCount}</span>
                        <span class="stat-label">Following</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-number">${profile.stats.postsCount}</span>
                        <span class="stat-label">Posts</span>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.getElementById('profileMainContent').innerHTML = `
        <div class="profile-bio">${profile.bio || 'No bio yet.'}</div>
        <div class="profile-details-grid mt-4">
            ${profile.institution ? `
                <div class="detail-item">
                    <i class="fas fa-university"></i>
                    <span>${profile.institution}</span>
                </div>
            ` : ''}
            ${profile.location ? `
                <div class="detail-item">
                    <i class="fas fa-map-marker-alt"></i>
                    <span>${profile.location}</span>
                </div>
            ` : ''}
            ${profile.website ? `
                <div class="detail-item">
                    <i class="fas fa-globe"></i>
                    <a href="${profile.website}" target="_blank" class="text-primary">${profile.website}</a>
                </div>
            ` : ''}
        </div>
        
        <div class="profile-actions mt-6">
            ${currentUser && currentUser.username !== profile.username ? `
                <button class="btn ${currentProfile?.isFollowing ? 'btn-unfollow' : 'btn-follow'}" 
                        onclick="toggleFollow('${profile.username}')">
                    ${currentProfile?.isFollowing ? 'Unfollow' : 'Follow'}
                </button>
            ` : ''}
            ${currentUser && currentUser.username === profile.username ? `
                <button class="btn btn-primary" onclick="showEditProfileModal()">
                    Edit Profile
                </button>
                <button class="btn btn-outline" onclick="showSettingsModal()">
                    Settings
                </button>
            ` : ''}
        </div>
    `;

    setupProfileTabs();
}

function setupProfileTabs() {
    document.getElementById('profileTabs').innerHTML = `
        <div class="profile-tab active" onclick="switchProfileTab('posts')">Posts</div>
        <div class="profile-tab" onclick="switchProfileTab('about')">About</div>
    `;
}

function switchProfileTab(tabName) {
    document.querySelectorAll('.profile-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    event.target.classList.add('active');
}

async function loadUserPosts(username) {
    try {
        const data = await api.get(`/profile/${username}/posts`);
        
        if (data.success) {
            document.getElementById('profileTabContent').innerHTML = `
                <div class="posts-container">
                    ${data.posts.length > 0 ? data.posts.map(post => {
                        const needsReadMore = post.content.length > 300;
                        const truncatedContent = needsReadMore ? post.content.substring(0, 300) + '...' : post.content;
                        
                        return `
                        <div class="post" data-post-id="${post._id}" data-full-content="${realTimeClient.encodeHTML(post.content)}">
                            <div class="post-content">
                                <h3 class="post-title" onclick="showPostPage('${post._id}')" style="cursor: pointer;">${post.title}</h3>
                                <div class="post-text ${needsReadMore ? 'truncated' : ''}" id="post-text-${post._id}">
                                    ${needsReadMore ? truncatedContent : post.content}
                                </div>
                                ${needsReadMore ? `
                                    <button class="read-more-btn" onclick="toggleReadMore('${post._id}')" id="read-more-${post._id}">
                                        <span>Read More</span>
                                        <i class="fas fa-chevron-down"></i>
                                    </button>
                                ` : ''}
                                <div class="post-actions">
                                    <span><i class="fas fa-heart"></i> ${post.likes.length}</span>
                                    <span><i class="fas fa-comment"></i> ${post.comments.length}</span>
                                    <span><i class="fas fa-eye"></i> ${post.views}</span>
                                </div>
                            </div>
                        </div>
                    `}).join('') : '<div class="text-center p-8"><p>No posts yet.</p></div>'}
                </div>
            `;
        }
    } catch (error) {
        console.error('Load user posts error:', error);
        document.getElementById('profileTabContent').innerHTML = '<div class="text-center p-8"><p>Error loading posts.</p></div>';
    }
}

async function loadUserInsights(username) {
    try {
        const data = await api.get(`/users/${username}/insights`);
        
        if (data.success) {
            document.getElementById('profileInsights').innerHTML = `
                <div class="space-y-3">
                    <div class="flex justify-between">
                        <span>Total Posts</span>
                        <span class="font-semibold">${data.insights.summary.totalPosts}</span>
                    </div>
                    <div class="flex justify-between">
                        <span>Total Likes</span>
                        <span class="font-semibold">${data.insights.summary.totalLikes}</span>
                    </div>
                    <div class="flex justify-between">
                        <span>Total Comments</span>
                        <span class="font-semibold">${data.insights.summary.totalComments}</span>
                    </div>
                </div>
            `;
        }
    } catch (error) {
        console.error('Load user insights error:', error);
        document.getElementById('profileInsights').innerHTML = '<div class="text-center text-secondary">Error loading insights</div>';
    }
}

// REAL-TIME FOLLOW/UNFOLLOW FUNCTIONALITY
async function toggleFollow(username) {
    if (!currentUser) {
        showLoginModal();
        return;
    }

    try {
        // Optimistic UI update
        const followBtn = document.querySelector('.btn-follow, .btn-unfollow');
        const originalText = followBtn?.textContent;
        const isCurrentlyFollowing = originalText === 'Unfollow';
        
        if (followBtn) {
            followBtn.textContent = isCurrentlyFollowing ? 'Follow' : 'Unfollow';
            followBtn.className = isCurrentlyFollowing ? 'btn btn-follow' : 'btn btn-unfollow';
            followBtn.disabled = true;
        }

        const data = await api.post(`/follow/${username}/follow`);
        
        if (data.success) {
            // Update current user's following list
            if (!currentUser.following) currentUser.following = [];
            
            if (data.following) {
                // Add to following
                if (!currentUser.following.some(f => f._id === data.userId || f === data.userId)) {
                    currentUser.following.push({ _id: data.userId, username: username });
                }
            } else {
                // Remove from following
                currentUser.following = currentUser.following.filter(f => 
                    !(f._id === data.userId || f === data.userId || (f.username && f.username === username))
                );
            }
            
            localStorage.setItem('currentUser', JSON.stringify(currentUser));

            // Update follower count on profile
            const followerCountElement = document.querySelector('.stat-item:nth-child(1) .stat-number');
            if (followerCountElement && data.followerCount !== undefined) {
                followerCountElement.textContent = data.followerCount;
            }

            // Update currentProfile state
            if (currentProfile) {
                currentProfile.isFollowing = data.following;
                currentProfile.stats.followerCount = data.followerCount || currentProfile.stats.followerCount;
            }

            // Refresh any open modals
            await refreshOpenModals();

            realTimeClient.showToast(data.message, 'success');
        }
    } catch (error) {
        console.error('Follow error:', error);
        realTimeClient.showToast(error.message || 'Failed to follow user', 'error');
        
        // Revert optimistic update
        const followBtn = document.querySelector('.btn-follow, .btn-unfollow');
        if (followBtn) {
            followBtn.textContent = originalText;
            followBtn.className = isCurrentlyFollowing ? 'btn btn-unfollow' : 'btn btn-follow';
        }
    } finally {
        const followBtn = document.querySelector('.btn-follow, .btn-unfollow');
        if (followBtn) {
            followBtn.disabled = false;
        }
    }
}
function setupEnhancedSearch() {
    const searchInput = document.getElementById('searchInput');
    
    searchInput.addEventListener('input', function(e) {
        const query = e.target.value.trim();
        
        // Clear previous timeout
        if (searchSuggestionsTimeout) {
            clearTimeout(searchSuggestionsTimeout);
        }
        
        // Show/hide suggestions based on input
        if (query.length > 1) {
            searchSuggestionsTimeout = setTimeout(() => {
                showSearchSuggestions(query);
            }, 300);
        } else {
            hideSearchSuggestions();
        }
    });
    
    // Hide suggestions when clicking outside
    document.addEventListener('click', function(e) {
        if (!e.target.closest('.search-bar')) {
            hideSearchSuggestions();
        }
    });
}

// Show search suggestions
async function showSearchSuggestions(query) {
    const searchBar = document.querySelector('.search-bar');
    let suggestionsContainer = document.getElementById('searchSuggestions');
    
    if (!suggestionsContainer) {
        suggestionsContainer = document.createElement('div');
        suggestionsContainer.id = 'searchSuggestions';
        suggestionsContainer.className = 'search-suggestions';
        searchBar.appendChild(suggestionsContainer);
    }
    
    // Show loading
    suggestionsContainer.innerHTML = '<div class="search-suggestion-item">Loading...</div>';
    suggestionsContainer.style.display = 'block';
    
    try {
        // Get both user and post suggestions
        const [usersData, postsData] = await Promise.all([
            api.get(`/users/search?username=${encodeURIComponent(query)}&limit=3`),
            api.get(`/posts?search=${encodeURIComponent(query)}&limit=3`)
        ]);
        
        let suggestionsHTML = '';
        
        // User suggestions
        if (usersData.success && usersData.users.length > 0) {
            suggestionsHTML += `
                <div class="search-suggestion-category">Users</div>
                ${usersData.users.map(user => `
                    <div class="search-suggestion-item" onclick="selectUserSuggestion('${user.username}')">
                        <i class="fas fa-user"></i>
                        <span>${user.name} (@${user.username})</span>
                        <small>User</small>
                    </div>
                `).join('')}
            `;
        }
        
        // Post suggestions
        if (postsData.success && postsData.posts.length > 0) {
            suggestionsHTML += `
                <div class="search-suggestion-category">Posts</div>
                ${postsData.posts.map(post => `
                    <div class="search-suggestion-item" onclick="selectPostSuggestion('${post._id}')">
                        <i class="fas fa-file-alt"></i>
                        <span>${post.title}</span>
                        <small>by ${post.author.name}</small>
                    </div>
                `).join('')}
            `;
        }
        
        if (!suggestionsHTML) {
            suggestionsHTML = '<div class="search-suggestion-item">No results found</div>';
        }
        
        suggestionsContainer.innerHTML = suggestionsHTML;
        
    } catch (error) {
        suggestionsContainer.innerHTML = '<div class="search-suggestion-item">Error loading suggestions</div>';
    }
}

// Hide search suggestions
function hideSearchSuggestions() {
    const suggestionsContainer = document.getElementById('searchSuggestions');
    if (suggestionsContainer) {
        suggestionsContainer.style.display = 'none';
    }
}

// Handle user suggestion selection
function selectUserSuggestion(username) {
    document.getElementById('searchInput').value = `u:${username}`;
    hideSearchSuggestions();
    handleSearch({ target: { value: `u:${username}` } });
}

// Handle post suggestion selection
function selectPostSuggestion(postId) {
    hideSearchSuggestions();
    showPostPage(postId);
}

// Add CSS for search suggestions
const searchSuggestionsStyles = `
    .search-suggestions {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        background: white;
        border: 1px solid var(--border-color);
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        z-index: 1000;
        max-height: 300px;
        overflow-y: auto;
        display: none;
    }
    
    .search-suggestion-category {
        padding: 8px 12px;
        font-weight: 600;
        font-size: 0.875rem;
        color: var(--secondary-color);
        background: var(--light-bg);
        border-bottom: 1px solid var(--border-color);
    }
    
    .search-suggestion-item {
        padding: 12px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
        border-bottom: 1px solid var(--border-color);
        transition: background-color 0.2s ease;
    }
    
    .search-suggestion-item:last-child {
        border-bottom: none;
    }
    
    .search-suggestion-item:hover {
        background: var(--hover-color);
    }
    
    .search-suggestion-item i {
        width: 16px;
        color: var(--secondary-color);
    }
    
    .search-suggestion-item span {
        flex: 1;
        font-weight: 500;
    }
    
    .search-suggestion-item small {
        color: var(--secondary-color);
        font-size: 0.75rem;
    }
    
    .search-bar {
        position: relative;
    }
`;

// Special follow function for modals that updates the modal UI
async function toggleModalFollow(username, button) {
    if (!currentUser) {
        showLoginModal();
        return;
    }

    const originalText = button.textContent;
    const isCurrentlyFollowing = originalText === 'Unfollow';
    
    // Optimistic update
    button.textContent = isCurrentlyFollowing ? 'Follow' : 'Unfollow';
    button.className = isCurrentlyFollowing ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm';
    button.disabled = true;

    try {
        const data = await api.post(`/follow/${username}/follow`);
        
        if (data.success) {
            // Update current user's following list
            if (!currentUser.following) currentUser.following = [];
            
            if (data.following) {
                if (!currentUser.following.some(f => f._id === data.userId || f === data.userId)) {
                    currentUser.following.push({ _id: data.userId, username: username });
                }
            } else {
                currentUser.following = currentUser.following.filter(f => 
                    !(f._id === data.userId || f === data.userId || (f.username && f.username === username))
                );
            }
            
            localStorage.setItem('currentUser', JSON.stringify(currentUser));

            realTimeClient.showToast(data.message, 'success');
        }
    } catch (error) {
        console.error('Modal follow error:', error);
        realTimeClient.showToast(error.message || 'Failed to follow user', 'error');
        
        // Revert optimistic update
        button.textContent = originalText;
        button.className = isCurrentlyFollowing ? 'btn btn-outline btn-sm' : 'btn btn-primary btn-sm';
    } finally {
        button.disabled = false;
    }
}

async function refreshOpenModals() {
    const followersModal = document.getElementById('followersModal');
    const followingModal = document.getElementById('followingModal');
    
    if (followersModal && followersModal.style.display === 'flex' && currentProfileUsername) {
        await showFollowersModal(currentProfileUsername);
    }
    
    if (followingModal && followingModal.style.display === 'flex' && currentProfileUsername) {
        await showFollowingModal(currentProfileUsername);
    }
}

async function showFollowersModal(username) {
    try {
        const data = await api.get(`/follow/${username}/followers`);
        
        if (data.success) {
            document.getElementById('followersList').innerHTML = `
                ${data.followers.length > 0 ? data.followers.map(follower => {
                    const isFollowing = currentUser && currentUser.following && 
                        currentUser.following.some(f => f._id === follower._id || f === follower._id);
                    
                    return `
                    <div class="follow-item">
                        <div class="avatar small" style="background: ${JSON.parse(follower.avatar).color}" onclick="showProfilePage('${follower.username}')">
                            ${JSON.parse(follower.avatar).initials}
                        </div>
                        <div class="follow-item-info">
                            <div class="follow-item-name" onclick="showProfilePage('${follower.username}')" style="cursor: pointer;">${follower.name}</div>
                            <div class="follow-item-username">@${follower.username}</div>
                        </div>
                        ${currentUser && currentUser.username !== follower.username ? `
                            <button class="btn ${isFollowing ? 'btn-outline' : 'btn-primary'} btn-sm follow-modal-btn" 
                                    onclick="toggleModalFollow('${follower.username}', this)">
                                ${isFollowing ? 'Unfollow' : 'Follow'}
                            </button>
                        ` : ''}
                    </div>
                    `;
                }).join('') : '<div class="text-center py-4">No followers yet</div>'}
            `;
            showModal('followersModal');
        }
    } catch (error) {
        console.error('Load followers error:', error);
        realTimeClient.showToast('Error loading followers list', 'error');
    }
}

async function showFollowingModal(username) {
    try {
        const data = await api.get(`/follow/${username}/following`);
        
        if (data.success) {
            document.getElementById('followingList').innerHTML = `
                ${data.following.length > 0 ? data.following.map(following => {
                    const isFollowing = currentUser && currentUser.following && 
                        currentUser.following.some(f => f._id === following._id || f === following._id);
                    
                    return `
                    <div class="follow-item">
                        <div class="avatar small" style="background: ${JSON.parse(following.avatar).color}" onclick="showProfilePage('${following.username}')">
                            ${JSON.parse(following.avatar).initials}
                        </div>
                        <div class="follow-item-info">
                            <div class="follow-item-name" onclick="showProfilePage('${following.username}')" style="cursor: pointer;">${following.name}</div>
                            <div class="follow-item-username">@${following.username}</div>
                        </div>
                        ${currentUser && currentUser.username !== following.username ? `
                            <button class="btn ${isFollowing ? 'btn-outline' : 'btn-primary'} btn-sm follow-modal-btn" 
                                    onclick="toggleModalFollow('${following.username}', this)">
                                ${isFollowing ? 'Unfollow' : 'Follow'}
                            </button>
                        ` : ''}
                    </div>
                    `;
                }).join('') : '<div class="text-center py-4">Not following anyone yet</div>'}
            `;
            showModal('followingModal');
        }
    } catch (error) {
        console.error('Load following error:', error);
        realTimeClient.showToast('Error loading following list', 'error');
    }
}

// Modal functions
function showLoginModal() {
    showModal('loginModal');
}

function showSignupModal() {
    showModal('signupModal');
}

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
    
    showModal('editProfileModal');
}

function showSettingsModal() {
    if (!currentUser) return;
    
    document.getElementById('emailNotifications').checked = currentUser.preferences?.emailNotifications !== false;
    document.getElementById('pushNotifications').checked = currentUser.preferences?.pushNotifications !== false;
    document.getElementById('privateAccount').checked = currentUser.preferences?.privateAccount || false;
    
    showModal('settingsModal');
}

function showModal(modalId) {
    document.getElementById(modalId).style.display = 'flex';
}

function closeModal(modal) {
    modal.style.display = 'none';
}

// Utility functions
function getInitials(name) {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function getTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString();
}

function showHomePage() {
    homePage.style.display = 'block';
    profilePage.style.display = 'none';
    notificationsPage.style.display = 'none';
    postPage.style.display = 'none';
    currentProfile = null;
    currentProfileUsername = null;
}

function showAlert(message, type) {
    const alert = document.createElement('div');
    alert.className = `alert alert-${type} alert-toast`;
    alert.innerHTML = `
        <div class="flex items-center gap-3">
            <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-triangle'}"></i>
            <span>${message}</span>
        </div>
        <button class="alert-close" onclick="this.parentElement.remove()">&times;</button>
    `;
    
    document.body.appendChild(alert);
    
    setTimeout(() => {
        if (alert.parentElement) {
            alert.remove();
        }
    }, 5000);
}

// Form handlers
async function handleCreatePost(e) {
    e.preventDefault();
    
    if (!currentUser) {
        showLoginModal();
        return;
    }

    document.getElementById('postErrorAlert').style.display = 'none';
    document.querySelectorAll('.form-error').forEach(el => el.style.display = 'none');

    const formData = {
        title: document.getElementById('postTitle').value.trim(),
        content: document.getElementById('postContent').value.trim(),
        category: document.getElementById('postCategory').value,
        tags: document.getElementById('postTags').value
    };

    let hasErrors = false;
    if (!formData.title) {
        document.getElementById('postTitleError').style.display = 'block';
        hasErrors = true;
    }
    if (!formData.category) {
        document.getElementById('postCategoryError').style.display = 'block';
        hasErrors = true;
    }
    if (!formData.content) {
        document.getElementById('postContentError').style.display = 'block';
        hasErrors = true;
    }

    if (hasErrors) return;

    try {
        const data = await api.post('/posts', formData);
        
        if (data.success) {
            document.getElementById('postForm').reset();
            closeModal(document.getElementById('createPostModal'));
            realTimeClient.showToast('Post created successfully!', 'success');
        }
    } catch (error) {
        console.error('Create post error:', error);
        
        if (error.errors && Array.isArray(error.errors)) {
            const errorMessages = error.errors.map(err => err.msg).join(', ');
            document.getElementById('postErrorAlert').textContent = errorMessages;
            document.getElementById('postErrorAlert').style.display = 'block';
        } else {
            realTimeClient.showToast(error.message || 'Failed to create post', 'error');
        }
    }
}

async function handleLogin(e) {
    e.preventDefault();
    
    const formData = {
        identifier: document.getElementById('loginEmail').value,
        password: document.getElementById('loginPassword').value
    };

    try {
        const data = await api.post('/auth/login', formData);
        
        if (data.success) {
            localStorage.setItem('token', data.token);
            localStorage.setItem('currentUser', JSON.stringify(data.user));
            currentUser = data.user;
            
            closeModal(document.getElementById('loginModal'));
            updateUI();
            await loadPosts();
            await loadNotifications();
            realTimeClient.connect();
            realTimeClient.showToast('Login successful!', 'success');
        }
    } catch (error) {
        if (error.message && error.message.includes('verify your email')) {
            const userId = error.userId || error.response?.data?.userId;
            if (userId) {
                closeModal(document.getElementById('loginModal'));
                showOTPVerificationModal(userId, formData.identifier);
            }
        }
        realTimeClient.showToast(error.message || 'Login failed', 'error');
    }
}

async function handleSignup(e) {
    e.preventDefault();
    
    const formData = {
        // Remove username field
        name: document.getElementById('signupName').value.trim(),
        email: document.getElementById('signupEmail').value,
        password: document.getElementById('signupPassword').value,
        field: document.getElementById('signupField').value
    };

    // If name is empty, set it to null (server will generate anonymous username)
    if (!formData.name) {
        formData.name = null;
    }

    try {
        const data = await api.post('/auth/register', formData);
        
        if (data.success) {
            closeModal(document.getElementById('signupModal'));
            showOTPVerificationModal(data.userId, data.email);
            realTimeClient.showToast('Verification code sent to your email!', 'success');
            
            if (data.developmentOTP) {
                console.log('Development OTP:', data.developmentOTP);
            }
        }
    } catch (error) {
        realTimeClient.showToast(error.message || 'Registration failed', 'error');
    }
}

async function handleEditProfile(e) {
    e.preventDefault();
    
    if (!currentUser) {
        realTimeClient.showToast('Please log in to edit your profile', 'error');
        return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    submitBtn.disabled = true;

    try {
        const formData = {
            name: document.getElementById('editName').value,
            bio: document.getElementById('editBio').value,
            field: document.getElementById('editField').value,
            institution: document.getElementById('editInstitution').value,
            location: document.getElementById('editLocation').value,
            website: document.getElementById('editWebsite').value,
            socialLinks: {
                twitter: document.getElementById('editTwitter').value,
                linkedin: document.getElementById('editLinkedIn').value,
                github: document.getElementById('editGitHub').value,
                orcid: document.getElementById('editORCID').value
            }
        };

        console.log('Sending profile update:', formData);

        const data = await api.put('/profile/update', formData);
        
        if (data.success) {
            currentUser = data.user;
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            
            closeModal(document.getElementById('editProfileModal'));
            
            if (currentProfileUsername) {
                await loadUserProfile(currentProfileUsername);
            }
            
            realTimeClient.showToast('Profile updated successfully!', 'success');
        }
    } catch (error) {
        console.error('Profile update error:', error);
        
        if (error.message && error.message.includes('Validation failed')) {
            realTimeClient.showToast('Please check your input: ' + error.message, 'error');
        } else {
            realTimeClient.showToast(error.message || 'Failed to update profile. Please try again.', 'error');
        }
    } finally {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
}

// Enhanced Authentication Functions
async function handleForgotPassword(e) {
    e.preventDefault();
    
    const email = document.getElementById('forgotPasswordEmail').value.trim();
    
    document.getElementById('forgotPasswordErrorAlert').style.display = 'none';
    document.getElementById('forgotPasswordEmailError').style.display = 'none';

    if (!email) {
        document.getElementById('forgotPasswordEmailError').style.display = 'block';
        return;
    }

    try {
        const data = await api.post('/auth/forgot-password', { email });
        
        if (data.success) {
            closeModal(document.getElementById('forgotPasswordModal'));
            realTimeClient.showToast(data.message, 'success');
            setTimeout(() => {
                showModal('resetPasswordModal');
            }, 1000);
        }
    } catch (error) {
        document.getElementById('forgotPasswordErrorAlert').textContent = error.message;
        document.getElementById('forgotPasswordErrorAlert').style.display = 'block';
    }
}

async function handleResetPassword(e) {
    e.preventDefault();
    
    const token = document.getElementById('resetToken').value.trim();
    const password = document.getElementById('newPassword').value;

    document.getElementById('resetPasswordErrorAlert').style.display = 'none';
    document.querySelectorAll('#resetPasswordForm .form-error').forEach(el => el.style.display = 'none');

    let hasErrors = false;
    if (!token) {
        document.getElementById('resetTokenError').style.display = 'block';
        hasErrors = true;
    }
    if (!password || password.length < 6) {
        document.getElementById('newPasswordError').style.display = 'block';
        hasErrors = true;
    }
    if (hasErrors) return;

    try {
        const data = await api.post('/auth/reset-password', { token, password });
        
        if (data.success) {
            closeModal(document.getElementById('resetPasswordModal'));
            realTimeClient.showToast(data.message, 'success');
            showLoginModal();
        }
    } catch (error) {
        document.getElementById('resetPasswordErrorAlert').textContent = error.message;
        document.getElementById('resetPasswordErrorAlert').style.display = 'block';
    }
}

async function handleOTPVerification(e) {
    e.preventDefault();
    
    const userId = document.getElementById('otpUserId').value;
    const otp = document.getElementById('otpCode').value.trim();

    document.getElementById('otpErrorAlert').style.display = 'none';
    document.getElementById('otpCodeError').style.display = 'none';

    if (!otp || otp.length !== 6) {
        document.getElementById('otpCodeError').style.display = 'block';
        return;
    }

    try {
        const data = await api.post('/auth/verify-otp', { userId, otp });
        
        if (data.success) {
            localStorage.setItem('token', data.token);
            localStorage.setItem('currentUser', JSON.stringify(data.user));
            currentUser = data.user;
            
            closeModal(document.getElementById('otpVerificationModal'));
            updateUI();
            await loadPosts();
            realTimeClient.connect();
            realTimeClient.showToast('Email verified successfully! Welcome to ResearchHub!', 'success');
        }
    } catch (error) {
        document.getElementById('otpErrorAlert').textContent = error.message;
        document.getElementById('otpErrorAlert').style.display = 'block';
    }
}

async function handleChangePassword(e) {
    e.preventDefault();
    
    if (!currentUser) {
        realTimeClient.showToast('Please log in to change password', 'error');
        return;
    }

    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPasswordChange').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

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
            closeModal(document.getElementById('changePasswordModal'));
            closeModal(document.getElementById('settingsModal'));
            realTimeClient.showToast('Password changed successfully!', 'success');
            document.getElementById('changePasswordForm').reset();
        }
    } catch (error) {
        document.getElementById('changePasswordErrorAlert').textContent = error.message;
        document.getElementById('changePasswordErrorAlert').style.display = 'block';
    }
}

async function handleDeleteAccount(e) {
    e.preventDefault();
    
    if (!currentUser) {
        realTimeClient.showToast('Please log in to delete account', 'error');
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
            currentUser = null;
            
            closeModal(document.getElementById('deleteAccountModal'));
            closeModal(document.getElementById('settingsModal'));
            updateUI();
            showHomePage();
            realTimeClient.showToast('Your account has been permanently deleted.', 'success');
        }
    } catch (error) {
        document.getElementById('deleteAccountErrorAlert').textContent = error.message;
        document.getElementById('deleteAccountErrorAlert').style.display = 'block';
    }
}

async function resendOTP() {
    const userId = document.getElementById('otpUserId').value;

    if (!userId) {
        realTimeClient.showToast('User ID not found. Please try signing up again.', 'error');
        return;
    }

    try {
        const data = await api.post('/auth/resend-otp', { userId });
        
        if (data.success) {
            realTimeClient.showToast('Verification code sent to your email!', 'success');
        }
    } catch (error) {
        realTimeClient.showToast(error.message || 'Failed to resend verification code', 'error');
    }
}

// Modal display functions
function showForgotPasswordModal() {
    closeModal(document.getElementById('loginModal'));
    showModal('forgotPasswordModal');
}

function showChangePasswordModal() {
    closeModal(document.getElementById('settingsModal'));
    showModal('changePasswordModal');
}

function showDeleteAccountModal() {
    closeModal(document.getElementById('settingsModal'));
    showModal('deleteAccountModal');
}

function showOTPVerificationModal(userId, email) {
    document.getElementById('otpUserId').value = userId;
    showModal('otpVerificationModal');
}

// Username availability check
async function checkUsernameAvailability(username) {
    if (username.length < 3) {
        document.getElementById('usernameAvailability').textContent = 'Username must be at least 3 characters';
        document.getElementById('usernameAvailability').className = 'text-xs text-error mt-1';
        return;
    }

    try {
        const data = await api.get(`/auth/check-username/${username}`);
        
        if (data.success) {
            if (data.available) {
                document.getElementById('usernameAvailability').textContent = 'Username is available';
                document.getElementById('usernameAvailability').className = 'text-xs text-success mt-1';
            } else {
                document.getElementById('usernameAvailability').textContent = 'Username is taken';
                document.getElementById('usernameAvailability').className = 'text-xs text-error mt-1';
                
                if (data.suggestions && data.suggestions.length > 0) {
                    const suggestions = data.suggestions.slice(0, 3).join(', ');
                    document.getElementById('usernameAvailability').textContent += `. Suggestions: ${suggestions}`;
                }
            }
        }
    } catch (error) {
        console.error('Username check failed:', error);
    }
}

// Bio character counter
function setupBioCharCounter() {
    const bioTextarea = document.getElementById('editBio');
    const charCount = document.getElementById('bioCharCount');
    
    if (bioTextarea && charCount) {
        bioTextarea.addEventListener('input', function() {
            const length = this.value.length;
            charCount.textContent = `${length}/500`;
            
            if (length > 500) {
                charCount.classList.add('text-error');
            } else {
                charCount.classList.remove('text-error');
            }
        });
    }
}

// Search function
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

// Toggle comments visibility
function toggleComments(postId) {
    const commentsSection = document.getElementById(`comments-${postId}`);
    if (commentsSection) {
        commentsSection.style.display = commentsSection.style.display === 'block' ? 'none' : 'block';
        
        if (commentsSection.style.display === 'block') {
            setTimeout(() => {
                setupCommentTyping(postId);
            }, 100);
        }
    }
}

function setupCommentTyping(postId) {
    const commentInput = document.getElementById(`comment-${postId}`);
    if (commentInput) {
        commentInput.addEventListener('input', () => {
            handleCommentTyping(postId, 'new-comment');
        });
        
        commentInput.addEventListener('blur', () => {
            if (realTimeClient) {
                realTimeClient.stopTyping(postId);
            }
        });
    }
}

// Typing indicator handlers
let typingTimeouts = {};

function handleCommentTyping(postId, commentId) {
    if (realTimeClient && realTimeClient.isConnected) {
        realTimeClient.startTyping(postId);
        
        if (typingTimeouts[postId]) {
            clearTimeout(typingTimeouts[postId]);
        }
        
        typingTimeouts[postId] = setTimeout(() => {
            if (realTimeClient) {
                realTimeClient.stopTyping(postId);
            }
        }, 2000);
    }
}

function logout() {
    if (realTimeClient) {
        realTimeClient.disconnect();
    }
    
    localStorage.removeItem('token');
    localStorage.removeItem('currentUser');
    localStorage.removeItem('userLikes'); // Clear likes on logout
    currentUser = null;
    userLikes = {};
    updateUI();
    showHomePage();
    realTimeClient.showToast('Logged out successfully', 'success');
}

// Event listeners
function setupEventListeners() {
    document.getElementById('postForm').addEventListener('submit', handleCreatePost);
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.getElementById('signupForm').addEventListener('submit', handleSignup);
    document.getElementById('editProfileForm').addEventListener('submit', handleEditProfile);
    document.getElementById('editPostForm').addEventListener('submit', handleEditPost);
    
    document.getElementById('forgotPasswordForm').addEventListener('submit', handleForgotPassword);
    document.getElementById('resetPasswordForm').addEventListener('submit', handleResetPassword);
    document.getElementById('otpVerificationForm').addEventListener('submit', handleOTPVerification);
    document.getElementById('changePasswordForm').addEventListener('submit', handleChangePassword);
    document.getElementById('deleteAccountForm').addEventListener('submit', handleDeleteAccount);
    
    const usernameInput = document.getElementById('signupUsername');
    if (usernameInput) {
        usernameInput.addEventListener('input', debounce(function() {
            checkUsernameAvailability(this.value);
        }, 500));
    }
    
    searchInput.addEventListener('input', debounce(handleSearch, 300));
    
    document.getElementById('createPostBtn').addEventListener('click', () => {
        showModal('createPostModal');
    });

    setupBioCharCounter();
}

function setupGlobalEventListeners() {
    document.querySelectorAll('.close-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            closeModal(this.closest('.modal'));
        });
    });
    
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', function(e) {
            if (e.target === this) {
                closeModal(this);
            }
        });
    });

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal').forEach(modal => {
                closeModal(modal);
            });
        }
    });
    
    document.getElementById('showSignup')?.addEventListener('click', function(e) {
        e.preventDefault();
        closeModal(document.getElementById('loginModal'));
        showSignupModal();
    });
    
    document.getElementById('showLogin')?.addEventListener('click', function(e) {
        e.preventDefault();
        closeModal(document.getElementById('signupModal'));
        showLoginModal();
    });

    document.addEventListener('click', function(event) {
        const notificationContainer = document.querySelector('.notification-container');
        const dropdown = document.getElementById('notificationDropdown');
        
        if (notificationContainer && !notificationContainer.contains(event.target) && dropdown) {
            dropdown.classList.remove('show');
        }
    });
}

// Initialize app when DOM is loaded
window.showHomePage = showHomePage;
window.showProfilePage = showProfilePage;
window.showAllNotifications = showAllNotifications;
window.showLoginModal = showLoginModal;
window.showSignupModal = showSignupModal;
window.showEditProfileModal = showEditProfileModal;
window.showSettingsModal = showSettingsModal;
window.likePost = likePost;
window.addComment = addComment;
window.toggleComments = toggleComments;
window.toggleFollow = toggleFollow;
window.showFollowersModal = showFollowersModal;
window.showFollowingModal = showFollowingModal;
window.editPost = editPost;
window.deletePost = deletePost;
window.handleDeletePostFromEdit = handleDeletePostFromEdit;
window.logout = logout;
window.closeModal = closeModal;
window.showModal = showModal;
window.toggleReadMore = toggleReadMore;
window.deleteComment = deleteComment;
window.deleteReply = deleteReply;
window.addReply = addReply;
window.likeComment = likeComment;
window.likeReply = likeReply;
window.toggleReplyForm = toggleReplyForm;
window.showForgotPasswordModal = showForgotPasswordModal;
window.showChangePasswordModal = showChangePasswordModal;
window.showDeleteAccountModal = showDeleteAccountModal;
window.resendOTP = resendOTP;
window.toggleNotifications = toggleNotifications;
window.markAllNotificationsAsRead = markAllNotificationsAsRead;
window.clearAllNotifications = clearAllNotifications;
window.handleNotificationClick = handleNotificationClick;
window.deleteNotification = deleteNotification;
window.handleCommentTyping = handleCommentTyping;
window.switchFeed = switchFeed;
window.switchSort = switchSort;
window.toggleModalFollow = toggleModalFollow;
window.showPostPage = showPostPage;
window.addCommentFromPostPage = addCommentFromPostPage;
window.focusCommentInput = focusCommentInput;
window.showSharePostModal = showSharePostModal;
window.copyPostLink = copyPostLink;
window.shareOnTwitter = shareOnTwitter;
window.shareOnLinkedIn = shareOnLinkedIn;
window.shareOnFacebook = shareOnFacebook;
window.shareViaEmail = shareViaEmail;
window.togglePostDetailReplyForm = togglePostDetailReplyForm;
window.addPostDetailReply = addPostDetailReply;

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', initApp);
