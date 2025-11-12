import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../utils/api';
import { UserPlus, Check, X, Users, Search } from 'lucide-react';

export default function FriendsPage() {
  const { user } = useAuth();
  const [friends, setFriends] = useState([]);
  const [friendRequests, setFriendRequests] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const searchTimeoutRef = useRef(null);

  useEffect(() => {
    loadFriends();
    loadFriendRequests();
    
    // Cleanup timeout on unmount
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  const loadFriends = async () => {
    try {
      const data = await api.getFriends();
      setFriends(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadFriendRequests = async () => {
    try {
      const data = await api.getFriendRequests();
      setFriendRequests(data);
    } catch (err) {
      console.error('Error loading friend requests:', err);
    }
  };

  const searchUsers = async (query = null) => {
    const queryToUse = query !== null ? query : searchQuery.trim();
    
    if (!queryToUse) {
      setSearchResults([]);
      return;
    }

    if (queryToUse.length < 2) {
      setSearchResults([]);
      return;
    }

    try {
      const results = await api.searchUsers(queryToUse);
      setSearchResults(results);
      setError(null);
    } catch (err) {
      setError(err.message);
      setSearchResults([]);
    }
  };

  const sendFriendRequest = async (user) => {
    try {
      // user should be an object with id, email, or username
      let recipientId = null;
      let recipientEmail = null;
      let recipientUsername = null;

      if (user.id) {
        recipientId = user.id;
      } else if (user.email) {
        recipientEmail = user.email;
      } else if (user.username) {
        recipientUsername = user.username;
      } else {
        throw new Error('Invalid user data');
      }

      await api.sendFriendRequest(recipientId, recipientEmail, recipientUsername);
      setError(null);
      setSearchQuery('');
      setSearchResults([]);
      await loadFriendRequests();
      alert('Friend request sent!');
    } catch (err) {
      setError(err.message);
    }
  };

  const acceptFriendRequest = async (requestId) => {
    try {
      await api.acceptFriendRequest(requestId);
      await loadFriendRequests();
      await loadFriends();
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const rejectFriendRequest = async (requestId) => {
    try {
      await api.rejectFriendRequest(requestId);
      await loadFriendRequests();
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const removeFriend = async (friendId) => {
    if (!window.confirm('Are you sure you want to remove this friend?')) {
      return;
    }

    try {
      await api.removeFriend(friendId);
      await loadFriends();
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const pendingReceived = friendRequests.filter(
    req => req.status === 'pending' && req.recipient_id === user?.id
  );

  const pendingSent = friendRequests.filter(
    req => req.status === 'pending' && req.sender_id === user?.id
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-darker">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-darker py-8">
      <div className="container mx-auto px-4 max-w-6xl">
        <h1 className="text-4xl font-bold mb-8 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
          Friends
        </h1>

        {error && (
          <div className="bg-red-500/20 border border-red-500 text-red-200 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        {/* Send Friend Request Section */}
        <div className="glass-effect rounded-2xl p-6 mb-8">
          <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
            <UserPlus className="w-6 h-6" />
            Add Friend
          </h2>
          <div className="flex gap-2 mb-4">
            <div className="flex-1 relative">
              <input
                type="text"
                placeholder="Search by email or username..."
                value={searchQuery}
                onChange={(e) => {
                  const value = e.target.value;
                  setSearchQuery(value);
                  
                  // Clear previous timeout
                  if (searchTimeoutRef.current) {
                    clearTimeout(searchTimeoutRef.current);
                  }
                  
                  if (value.trim().length >= 2) {
                    // Debounce search by 500ms
                    const queryValue = value.trim();
                    searchTimeoutRef.current = setTimeout(() => {
                      searchUsers(queryValue);
                    }, 500);
                  } else {
                    setSearchResults([]);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && searchQuery.trim().length >= 2) {
                    searchUsers();
                  }
                }}
                className="w-full bg-glass border border-gray-600 rounded-xl px-4 py-3 pl-10 focus:outline-none focus:border-primary"
              />
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            </div>
            <button
              onClick={() => {
                if (searchTimeoutRef.current) {
                  clearTimeout(searchTimeoutRef.current);
                }
                searchUsers();
              }}
              className="bg-primary hover:bg-green-600 text-white px-6 py-3 rounded-xl font-semibold transition-all duration-300 flex items-center gap-2"
            >
              <Search className="w-5 h-5" />
              Search
            </button>
          </div>

          {/* Search Results */}
          {searchResults.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-sm text-gray-400">Search Results:</p>
              {searchResults.map((user) => {
                // Check if already friends
                const isFriend = friends.some(f => f.id === user.id);
                // Check if request already sent
                const requestSent = pendingSent.some(r => r.recipient_id === user.id);
                // Check if request received
                const requestReceived = pendingReceived.some(r => r.sender_id === user.id);

                return (
                  <div
                    key={user.id}
                    className="bg-glass rounded-xl p-4 flex items-center justify-between hover:bg-glass/80 transition-colors"
                  >
                    <div>
                      <h3 className="font-semibold">{user.username}</h3>
                      <p className="text-sm text-gray-400">{user.email}</p>
                    </div>
                    <div>
                      {isFriend ? (
                        <span className="text-green-400 text-sm">Already friends</span>
                      ) : requestSent ? (
                        <span className="text-yellow-400 text-sm">Request sent</span>
                      ) : requestReceived ? (
                        <span className="text-blue-400 text-sm">Request received</span>
                      ) : (
                        <button
                          onClick={() => sendFriendRequest(user)}
                          className="bg-primary hover:bg-green-600 text-white px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
                        >
                          <UserPlus className="w-4 h-4" />
                          Add Friend
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {searchQuery.trim().length > 0 && searchQuery.trim().length < 2 && (
            <p className="text-gray-400 text-sm mt-2">
              Type at least 2 characters to search
            </p>
          )}
        </div>

        {/* Friend Requests Section */}
        {(pendingReceived.length > 0 || pendingSent.length > 0) && (
          <div className="glass-effect rounded-2xl p-6 mb-8">
            <h2 className="text-2xl font-semibold mb-6 flex items-center gap-2">
              <UserPlus className="w-6 h-6" />
              Friend Requests
            </h2>

            {/* Received Requests */}
            {pendingReceived.length > 0 && (
              <div className="mb-6">
                <h3 className="text-lg font-semibold mb-3 text-gray-300">
                  Received ({pendingReceived.length})
                </h3>
                <div className="space-y-3">
                  {pendingReceived.map((request) => (
                    <div
                      key={request.id}
                      className="bg-glass rounded-xl p-4 flex items-center justify-between hover:bg-glass/80 transition-colors"
                    >
                      <div className="flex-1">
                        <p className="font-semibold text-lg">{request.sender_username}</p>
                        <p className="text-sm text-gray-400">{request.sender_email}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          {new Date(request.created_at).toLocaleDateString()} at{' '}
                          {new Date(request.created_at).toLocaleTimeString()}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => acceptFriendRequest(request.id)}
                          className="bg-primary hover:bg-green-600 text-white px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
                        >
                          <Check className="w-4 h-4" />
                          Accept
                        </button>
                        <button
                          onClick={() => rejectFriendRequest(request.id)}
                          className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
                        >
                          <X className="w-4 h-4" />
                          Decline
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sent Requests */}
            {pendingSent.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold mb-3 text-gray-300">
                  Sent ({pendingSent.length})
                </h3>
                <div className="space-y-3">
                  {pendingSent.map((request) => (
                    <div
                      key={request.id}
                      className="bg-glass rounded-xl p-4 hover:bg-glass/80 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-lg">{request.recipient_username}</p>
                          <p className="text-sm text-gray-400">{request.recipient_email}</p>
                          <p className="text-xs text-gray-500 mt-1">
                            Sent {new Date(request.created_at).toLocaleDateString()} at{' '}
                            {new Date(request.created_at).toLocaleTimeString()}
                          </p>
                        </div>
                        <span className="px-3 py-1 bg-yellow-500/20 text-yellow-400 rounded-lg text-sm">
                          Pending
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Friends List */}
        <div className="glass-effect rounded-2xl p-6">
          <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
            <Users className="w-6 h-6" />
            My Friends ({friends.length})
          </h2>
          {friends.length === 0 ? (
            <p className="text-gray-400 text-center py-8">
              No friends yet. Send friend requests to get started!
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {friends.map((friend) => (
                <div
                  key={friend.id}
                  className="bg-glass rounded-xl p-4 hover:bg-glass/80 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-lg">{friend.username}</h3>
                      <p className="text-sm text-gray-400">{friend.email}</p>
                    </div>
                    <button
                      onClick={() => removeFriend(friend.id)}
                      className="text-red-400 hover:text-red-300 transition-colors"
                      title="Remove friend"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

