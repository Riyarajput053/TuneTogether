import { useState, useEffect } from 'react';
import { X, Search, UserPlus, Check } from 'lucide-react';
import { api } from '../utils/api';

const InviteFriendsModal = ({ isOpen, onClose, sessionId, onInvite }) => {
  const [friends, setFriends] = useState([]);
  const [filteredFriends, setFilteredFriends] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [invitedFriends, setInvitedFriends] = useState(new Set());

  useEffect(() => {
    if (isOpen) {
      loadFriends();
    }
  }, [isOpen]);

  useEffect(() => {
    if (searchQuery.trim() === '') {
      setFilteredFriends(friends.slice(0, 5));
    } else {
      const query = searchQuery.toLowerCase();
      const filtered = friends
        .filter(friend => 
          friend.username.toLowerCase().includes(query) ||
          friend.email.toLowerCase().includes(query)
        )
        .slice(0, 5);
      setFilteredFriends(filtered);
    }
  }, [searchQuery, friends]);

  const loadFriends = async () => {
    setLoading(true);
    try {
      const data = await api.getFriends();
      setFriends(data);
      setFilteredFriends(data.slice(0, 5));
    } catch (err) {
      console.error('Error loading friends:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleInvite = async (friend) => {
    try {
      if (onInvite) {
        await onInvite(friend.id, sessionId);
        setInvitedFriends(prev => new Set([...prev, friend.id]));
      }
    } catch (err) {
      console.error('Error inviting friend:', err);
      alert(err.message || 'Failed to invite friend');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-secondary rounded-2xl p-6 max-w-md w-full mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold">Invite Friends</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search friends..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-glass border border-gray-600 rounded-xl pl-10 pr-4 py-2 focus:outline-none focus:border-primary"
          />
        </div>

        {/* Friends List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="text-center py-8 text-gray-400">Loading friends...</div>
          ) : filteredFriends.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              {searchQuery ? 'No friends found' : 'No friends to invite'}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredFriends.map((friend) => {
                const isInvited = invitedFriends.has(friend.id);
                return (
                  <div
                    key={friend.id}
                    className="bg-glass rounded-xl p-4 flex items-center justify-between hover:bg-opacity-80 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center text-white font-semibold">
                        {friend.username.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-semibold">{friend.username}</div>
                        <div className="text-sm text-gray-400">{friend.email}</div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleInvite(friend)}
                      disabled={isInvited}
                      className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-colors ${
                        isInvited
                          ? 'bg-green-500 text-white cursor-not-allowed'
                          : 'bg-primary hover:bg-green-600 text-white'
                      }`}
                    >
                      {isInvited ? (
                        <>
                          <Check className="w-4 h-4" />
                          <span>Invited</span>
                        </>
                      ) : (
                        <>
                          <UserPlus className="w-4 h-4" />
                          <span>Invite</span>
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default InviteFriendsModal;

