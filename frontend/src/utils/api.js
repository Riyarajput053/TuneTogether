const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

// Helper function to get auth token from localStorage (for dev) or cookies
const getAuthToken = () => {
  // Try localStorage first (for dev)
  const token = localStorage.getItem('access_token');
  if (token) return token;
  // Cookies are automatically sent by browser
  return null;
};

// Helper function to set auth token
const setAuthToken = (token) => {
  localStorage.setItem('access_token', token);
};

// Helper function to remove auth token
const removeAuthToken = () => {
  localStorage.removeItem('access_token');
};

export const api = {
  async request(endpoint, options = {}) {
    const url = `${API_BASE_URL}${endpoint}`;
    const token = getAuthToken();
    
    const config = {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      credentials: 'include', // Include cookies
    };

    // Add Authorization header if token exists (for localStorage fallback)
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, config);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.detail || 'An error occurred');
      }
      
      return data;
    } catch (error) {
      throw error;
    }
  },

  async signup(userData) {
    const data = await this.request('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify(userData),
    });
    return data;
  },

  async login(userData) {
    const data = await this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(userData),
    });
    // Store token in localStorage as fallback
    if (data.access_token) {
      setAuthToken(data.access_token);
    }
    return data;
  },

  async logout() {
    try {
      await this.request('/api/auth/logout', {
        method: 'POST',
      });
    } finally {
      removeAuthToken();
    }
  },

  async getCurrentUser() {
    const data = await this.request('/api/auth/me');
    return data;
  },

  // Friends API
  async getFriends() {
    const data = await this.request('/api/friends');
    return data;
  },

  async searchUsers(query) {
    const data = await this.request(`/api/users/search?query=${encodeURIComponent(query)}`);
    return data;
  },

  async sendFriendRequest(recipientId, recipientEmail = null, recipientUsername = null) {
    const body = {};
    if (recipientId) {
      body.recipient_id = recipientId;
    } else if (recipientEmail) {
      body.recipient_email = recipientEmail;
    } else if (recipientUsername) {
      body.recipient_username = recipientUsername;
    }
    
    const data = await this.request('/api/friends/request', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return data;
  },

  async getFriendRequests() {
    const data = await this.request('/api/friends/requests');
    return data;
  },

  async acceptFriendRequest(requestId) {
    const data = await this.request(`/api/friends/requests/${requestId}/accept`, {
      method: 'POST',
    });
    return data;
  },

  async rejectFriendRequest(requestId) {
    const data = await this.request(`/api/friends/requests/${requestId}/reject`, {
      method: 'POST',
    });
    return data;
  },

  async removeFriend(friendId) {
    const data = await this.request(`/api/friends/${friendId}`, {
      method: 'DELETE',
    });
    return data;
  },

  // Sessions API
  async createSession(sessionData) {
    const data = await this.request('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(sessionData),
    });
    return data;
  },

  async getSessions(privateOnly = false) {
    const params = privateOnly ? '?private_only=true' : '';
    const data = await this.request(`/api/sessions${params}`);
    return data;
  },

  async getSession(sessionId) {
    const data = await this.request(`/api/sessions/${sessionId}`);
    return data;
  },

  async getSessionMessages(sessionId) {
    const data = await this.request(`/api/sessions/${sessionId}/messages`);
    return data;
  },

  async joinSession(sessionId) {
    const data = await this.request(`/api/sessions/${sessionId}/join`, {
      method: 'POST',
    });
    return data;
  },

  async leaveSession(sessionId) {
    const data = await this.request(`/api/sessions/${sessionId}/leave`, {
      method: 'POST',
    });
    return data;
  },

  async updateSession(sessionId, updates) {
    const data = await this.request(`/api/sessions/${sessionId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
    return data;
  },

  async deleteSession(sessionId) {
    const data = await this.request(`/api/sessions/${sessionId}`, {
      method: 'DELETE',
    });
    return data;
  },

  async inviteFriendToSession(sessionId, friendId) {
    const data = await this.request(`/api/sessions/${sessionId}/invite/${friendId}`, {
      method: 'POST',
    });
    return data;
  },

  async getSessionInvitations() {
    const data = await this.request('/api/sessions/invitations');
    return data;
  },

  async acceptSessionInvitation(invitationId) {
    const data = await this.request(`/api/sessions/invitations/${invitationId}/accept`, {
      method: 'POST',
    });
    return data;
  },

  async rejectSessionInvitation(invitationId) {
    const data = await this.request(`/api/sessions/invitations/${invitationId}/reject`, {
      method: 'POST',
    });
    return data;
  },

  // Session Requests API
  async requestToJoinSession(sessionId) {
    const data = await this.request(`/api/sessions/${sessionId}/request`, {
      method: 'POST',
    });
    return data;
  },

  async getSessionRequests(sessionId) {
    const data = await this.request(`/api/sessions/requests/${sessionId}`);
    return data;
  },

  async acceptSessionRequest(sessionId, requestId) {
    const data = await this.request(`/api/sessions/requests/${sessionId}/${requestId}/accept`, {
      method: 'POST',
    });
    return data;
  },

  async declineSessionRequest(sessionId, requestId) {
    const data = await this.request(`/api/sessions/requests/${sessionId}/${requestId}/decline`, {
      method: 'POST',
    });
    return data;
  },

  // Notifications API
  async getNotifications() {
    const data = await this.request('/api/notifications');
    return data;
  },

  async getUnreadNotifications() {
    const data = await this.request('/api/notifications/unread');
    return data;
  },

  async markNotificationRead(notificationId) {
    const data = await this.request(`/api/notifications/${notificationId}/read`, {
      method: 'POST',
    });
    return data;
  },

  async markAllNotificationsRead() {
    const data = await this.request('/api/notifications/read-all', {
      method: 'POST',
    });
    return data;
  },

  // Spotify API
  async connectSpotify() {
    // Get token from localStorage and append to URL for authentication
    const token = getAuthToken();
    if (!token) {
      throw new Error('Not authenticated. Please login first.');
    }
    // This will redirect to the backend endpoint which redirects to Spotify
    window.location.href = `${API_BASE_URL}/spotify/connect?token=${encodeURIComponent(token)}`;
  },

  async getSpotifyStatus() {
    const data = await this.request('/api/spotify/status');
    return data;
  },

  async getSpotifyToken() {
    const data = await this.request('/api/spotify/token');
    return data;
  },

  async getSpotifyPlaylists() {
    const data = await this.request('/api/spotify/playlists');
    return data;
  },

  async getPlaylistTracks(playlistId) {
    const data = await this.request(`/api/spotify/playlists/${playlistId}/tracks`);
    return data;
  },

  async getSpotifyRecommendations(params = {}) {
    const queryParams = new URLSearchParams();
    if (params.seed_genres) queryParams.append('seed_genres', params.seed_genres);
    if (params.seed_artists) queryParams.append('seed_artists', params.seed_artists);
    if (params.seed_tracks) queryParams.append('seed_tracks', params.seed_tracks);
    if (params.limit) queryParams.append('limit', params.limit);
    const query = queryParams.toString();
    const data = await this.request(`/api/spotify/recommendations${query ? '?' + query : ''}`);
    return data;
  },

  async searchSpotify(query, type = 'track', limit = 20) {
    const data = await this.request(`/api/spotify/search?q=${encodeURIComponent(query)}&type=${type}&limit=${limit}`);
    return data;
  },

  async getPopularSongs(limit = 50) {
    const data = await this.request(`/api/spotify/popular?limit=${limit}`);
    return data;
  },

  async getLatestSongs(limit = 50, country = 'US') {
    const data = await this.request(`/api/spotify/latest?limit=${limit}&country=${country}`);
    return data;
  },

  async getSpotifyCategories(country = 'US', limit = 20) {
    const data = await this.request(`/api/spotify/categories?country=${country}&limit=${limit}`);
    return data;
  },

  async getCategoryPlaylists(categoryId, country = 'US', limit = 20) {
    const data = await this.request(`/api/spotify/categories/${categoryId}/playlists?country=${country}&limit=${limit}`);
    return data;
  },

  async getCategoryTracks(category, limit = 20) {
    const data = await this.request(`/api/spotify/category-tracks?category=${encodeURIComponent(category)}&limit=${limit}`);
    return data;
  },
};

export { getAuthToken, setAuthToken, removeAuthToken };

