import { useState, useEffect } from 'react';
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

  useEffect(() => {
    loadFriends();
    loadFriendRequests();
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

  const searchUsers = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    try {
      // Note: This would require a search endpoint on the backend
      // For now, we'll show a message that search is not implemented
      setError('User search not yet implemented. Use friend ID to send requests.');
    } catch (err) {
      setError(err.message);
    }
  };

  const sendFriendRequest = async (recipientId) => {
    try {
      await api.sendFriendRequest(recipientId);
      setError(null);
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
            Send Friend Request
          </h2>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Enter user ID to send friend request"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-glass border border-gray-600 rounded-xl px-4 py-3 focus:outline-none focus:border-primary"
            />
            <button
              onClick={() => {
                if (searchQuery.trim()) {
                  sendFriendRequest(searchQuery.trim());
                  setSearchQuery('');
                }
              }}
              className="bg-primary hover:bg-green-600 text-white px-6 py-3 rounded-xl font-semibold transition-all duration-300"
            >
              Send Request
            </button>
          </div>
          <p className="text-gray-400 text-sm mt-2">
            Note: You need the user's ID to send a friend request. User search will be available soon.
          </p>
        </div>

        {/* Pending Friend Requests */}
        {pendingReceived.length > 0 && (
          <div className="glass-effect rounded-2xl p-6 mb-8">
            <h2 className="text-2xl font-semibold mb-4">Pending Requests</h2>
            <div className="space-y-3">
              {pendingReceived.map((request) => (
                <div
                  key={request.id}
                  className="bg-glass rounded-xl p-4 flex items-center justify-between"
                >
                  <div>
                    <p className="font-semibold">Request from user: {request.sender_id}</p>
                    <p className="text-sm text-gray-400">
                      {new Date(request.created_at).toLocaleDateString()}
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
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sent Requests */}
        {pendingSent.length > 0 && (
          <div className="glass-effect rounded-2xl p-6 mb-8">
            <h2 className="text-2xl font-semibold mb-4">Sent Requests</h2>
            <div className="space-y-3">
              {pendingSent.map((request) => (
                <div
                  key={request.id}
                  className="bg-glass rounded-xl p-4"
                >
                  <p className="font-semibold">Request to user: {request.recipient_id}</p>
                  <p className="text-sm text-gray-400">
                    Status: {request.status} • {new Date(request.created_at).toLocaleDateString()}
                  </p>
                </div>
              ))}
            </div>
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

