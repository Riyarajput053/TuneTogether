import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { MessageCircle, Users, Play, Pause, UserPlus, Check, X } from 'lucide-react';
import MiniPlayer from '../components/MiniPlayer';
import PrivacyTypeModal from '../components/PrivacyTypeModal';
import InviteFriendsModal from '../components/InviteFriendsModal';
import RequestSessionModal from '../components/RequestSessionModal';
import { api } from '../utils/api';
import { useSocket } from '../contexts/SocketContext';
import { useAuth } from '../contexts/AuthContext';

const StreamSongsPage = () => {
  const { user } = useAuth();
  const location = useLocation();
  const { socket, connected, joinSession, leaveSession, sendMessage, currentSessionId, clearSession } = useSocket();
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSong, setCurrentSong] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [currentSession, setCurrentSession] = useState(null);
  const [roomCode, setRoomCode] = useState('');
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [selectedSession, setSelectedSession] = useState(null);
  const [invitations, setInvitations] = useState([]);
  const [sessionRequests, setSessionRequests] = useState([]);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    loadSessions();
    loadInvitations();
    // Poll for new invitations every 5 seconds
    const interval = setInterval(loadInvitations, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // Clear session state when user changes or logs out
    if (!user) {
      setCurrentSession(null);
      setCurrentSong(null);
      setMessages([]);
      clearSession();
      return;
    }

    // Check if we're coming from a notification with session data
    if (location.state?.session) {
      setCurrentSession(location.state.session);
      setCurrentSong(location.state.session);
      // Clear the state to avoid re-using it
      window.history.replaceState({}, document.title);
    } else if (location.state?.sessionId) {
      // If we have sessionId from navigation, load it
      loadSessionById(location.state.sessionId);
      window.history.replaceState({}, document.title);
    } else if (currentSessionId && !currentSession && connected && user) {
      // If we have a currentSessionId from socket but no currentSession, verify and load it
      verifyAndLoadSession();
    }
  }, [location.state, currentSessionId, connected, user]);

  const verifyAndLoadSession = async () => {
    if (!currentSessionId || !user) return;
    try {
      const session = await api.getSession(currentSessionId);
      // Verify user is actually a member or host of this session
      const isHost = session.host_id === user.id;
      const isMember = session.members?.some(m => m.user_id === user.id);
      
      if (isHost || isMember) {
        setCurrentSession(session);
        setCurrentSong(session);
      } else {
        // User is not a member, clear the session
        clearSession();
        setCurrentSession(null);
        setCurrentSong(null);
      }
    } catch (err) {
      console.error('Error loading current session:', err);
      // If session doesn't exist or user doesn't have access, clear it
      clearSession();
      setCurrentSession(null);
      setCurrentSong(null);
    }
  };

  const loadSessionById = async (sessionId) => {
    try {
      const session = await api.getSession(sessionId);
      setCurrentSession(session);
      setCurrentSong(session);
      if (connected) {
        await joinSession(sessionId);
      }
    } catch (err) {
      console.error('Error loading session:', err);
    }
  };


  useEffect(() => {
    // Clear session if user changes and they're not a member
    if (currentSession && user) {
      const isHost = currentSession.host_id === user.id;
      const isMember = currentSession.members?.some(m => m.user_id === user.id);
      
      if (!isHost && !isMember) {
        // User is not a member of this session, clear it
        setCurrentSession(null);
        setCurrentSong(null);
        setMessages([]);
        clearSession();
        return;
      }
    }

    if (currentSession && currentSession.host_id === user?.id) {
      loadSessionRequests();
      // Poll for new requests every 3 seconds when host is in session
      const interval = setInterval(loadSessionRequests, 3000);
      return () => clearInterval(interval);
    }
  }, [currentSession, user]);

  useEffect(() => {
    if (!socket) return;

    // Listen for session updates
    socket.on('session_updated', (data) => {
      if (data.session_id === currentSessionId) {
        setCurrentSession((prev) => ({
          ...prev,
          ...data.updates
        }));
      }
    });

    // Listen for user join/leave
    socket.on('user_joined', (data) => {
      setMessages((prev) => [
        ...prev,
        {
          type: 'system',
          message: `${data.username} joined the session`,
          timestamp: new Date()
        }
      ]);
    });

    socket.on('user_left', (data) => {
      setMessages((prev) => [
        ...prev,
        {
          type: 'system',
          message: `${data.username} left the session`,
          timestamp: new Date()
        }
      ]);
    });

    // Listen for chat messages
    socket.on('chat:message', (data) => {
      // Only add message if it's not from current user (to avoid duplicates from optimistic update)
      // Or if it's from another user
      setMessages((prev) => {
        // Check if this message was already added optimistically
        const isDuplicate = prev.some(
          (msg) => 
            msg.type === 'user' && 
            msg.username === data.username && 
            msg.message === data.message &&
            Math.abs(new Date(msg.timestamp) - new Date(data.timestamp || Date.now())) < 2000
        );
        
        if (isDuplicate) {
          // Replace optimistic message with server message (to get correct timestamp)
          return prev.map((msg) => {
            if (
              msg.type === 'user' && 
              msg.username === data.username && 
              msg.message === data.message &&
              Math.abs(new Date(msg.timestamp) - new Date(data.timestamp || Date.now())) < 2000
            ) {
              return {
                ...msg,
                timestamp: new Date(data.timestamp || Date.now())
              };
            }
            return msg;
          });
        }
        
        return [
          ...prev,
          {
            type: 'user',
            username: data.username,
            message: data.message,
            timestamp: new Date(data.timestamp || Date.now())
          }
        ];
      });
    });

    return () => {
      socket.off('session_updated');
      socket.off('user_joined');
      socket.off('user_left');
      socket.off('chat:message');
    };
  }, [socket, currentSessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadSessions = async () => {
    try {
      const data = await api.getSessions();
      setSessions(data);
    } catch (err) {
      console.error('Error loading sessions:', err);
    }
  };

  const loadInvitations = async () => {
    try {
      const data = await api.getSessionInvitations();
      setInvitations(data);
    } catch (err) {
      console.error('Error loading invitations:', err);
    }
  };

  const loadSessionRequests = async () => {
    if (!currentSession || currentSession.host_id !== user?.id) return;
    try {
      const data = await api.getSessionRequests(currentSession.id);
      setSessionRequests(data);
    } catch (err) {
      console.error('Error loading session requests:', err);
    }
  };

  const handleStartJamClick = () => {
    if (!user) {
      setError('Please login to create a session');
      return;
    }
    setShowPrivacyModal(true);
  };

  const handleStartJam = async (privacyType) => {
    setShowPrivacyModal(false);
    setLoading(true);
    setError(null);

    try {
      // Create session via REST API
      const sessionData = {
        name: `${user.username}'s Jam Session`,
        description: 'Join me for some great music!',
        platform: 'spotify',
        privacy_type: privacyType
      };

      const newSession = await api.createSession(sessionData);
      
      // Join session via socket
      if (connected) {
        await joinSession(newSession.id);
        setCurrentSession(newSession);
        setCurrentSong(newSession);
        await loadSessions();
      } else {
        setError('Socket not connected. Please refresh the page.');
      }
    } catch (err) {
      setError(err.message || 'Failed to create session');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinJam = async () => {
    if (!roomCode.trim()) {
      setError('Please enter a session ID');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // First join via REST API
      const session = await api.joinSession(roomCode.trim());
      
      // Then join via socket
      if (connected) {
        await joinSession(session.id);
        setCurrentSession(session);
        setCurrentSong(session);
        setRoomCode('');
        await loadSessions();
      } else {
        setError('Socket not connected. Please refresh the page.');
      }
    } catch (err) {
      setError(err.message || 'Failed to join session');
    } finally {
      setLoading(false);
    }
  };

  const handleLeaveSession = async () => {
    if (!currentSession) return;

    try {
      if (currentSessionId) {
        await leaveSession(currentSession.id);
      }
      await api.leaveSession(currentSession.id);
      setCurrentSession(null);
      setCurrentSong(null);
      setMessages([]);
      clearSession();
      await loadSessions();
    } catch (err) {
      setError(err.message || 'Failed to leave session');
      // Clear session state even on error
      setCurrentSession(null);
      setCurrentSong(null);
      setMessages([]);
      clearSession();
    }
  };

  const handleDeleteSession = async () => {
    if (!currentSession) return;

    if (!window.confirm('Are you sure you want to delete this session? This action cannot be undone.')) {
      return;
    }

    try {
      if (currentSessionId) {
        await leaveSession(currentSession.id);
      }
      await api.deleteSession(currentSession.id);
      setCurrentSession(null);
      setCurrentSong(null);
      setMessages([]);
      clearSession();
      await loadSessions();
    } catch (err) {
      setError(err.message || 'Failed to delete session');
      // Clear session state even on error
      setCurrentSession(null);
      setCurrentSong(null);
      setMessages([]);
      clearSession();
    }
  };

  const handleInviteFriend = async (friendId, sessionId) => {
    try {
      await api.inviteFriendToSession(sessionId, friendId);
      // Just create invitation, don't update session yet
    } catch (err) {
      setError(err.message || 'Failed to invite friend');
      throw err;
    }
  };

  const handleAcceptInvitation = async (invitation) => {
    try {
      const session = await api.acceptSessionInvitation(invitation.id);
      // Join via socket
      if (connected) {
        await joinSession(session.id);
        setCurrentSession(session);
        setCurrentSong(session);
      }
      await loadInvitations();
      await loadSessions();
    } catch (err) {
      setError(err.message || 'Failed to accept invitation');
    }
  };

  const handleRejectInvitation = async (invitationId) => {
    try {
      await api.rejectSessionInvitation(invitationId);
      await loadInvitations();
    } catch (err) {
      setError(err.message || 'Failed to reject invitation');
    }
  };

  const handleSessionCardClick = (session) => {
    // Only show request modal for public or friends sessions
    if (session.privacy_type === 'public' || session.privacy_type === 'friends') {
      setSelectedSession(session);
      setShowRequestModal(true);
    } else {
      // For private sessions, try to join directly (if already a member)
      handleJoinSession(session);
    }
  };

  const handleJoinSession = async (session) => {
    try {
      await api.joinSession(session.id);
      if (connected) {
        await joinSession(session.id);
        setCurrentSession(session);
        setCurrentSong(session);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSendRequest = async (sessionId) => {
    try {
      await api.requestToJoinSession(sessionId);
      setShowRequestModal(false);
      setSelectedSession(null);
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to send request');
    }
  };

  const handleAcceptRequest = async (request) => {
    try {
      const updatedSession = await api.acceptSessionRequest(currentSession.id, request.id);
      setCurrentSession(updatedSession);
      await loadSessionRequests();
      await loadSessions();
    } catch (err) {
      setError(err.message || 'Failed to accept request');
    }
  };

  const handleDeclineRequest = async (requestId) => {
    try {
      await api.declineSessionRequest(currentSession.id, requestId);
      await loadSessionRequests();
    } catch (err) {
      setError(err.message || 'Failed to decline request');
    }
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!messageInput.trim() || !currentSessionId || !user) return;

    const messageText = messageInput.trim();
    
    // Optimistic update - show message immediately
    setMessages((prev) => [
      ...prev,
      {
        type: 'user',
        username: user.username,
        message: messageText,
        timestamp: new Date()
      }
    ]);

    try {
      sendMessage(messageText);
      setMessageInput('');
    } catch (err) {
      setError(err.message || 'Failed to send message');
      // Remove the optimistic message on error
      setMessages((prev) => prev.slice(0, -1));
    }
  };

  const handlePlayPause = () => {
    setIsPlaying(!isPlaying);
    // TODO: Update session state via socket
  };

  const formatTime = (date) => {
    if (!date) return '';
    return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="min-h-screen bg-darker">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            Listen Together on Spotify
          </h1>
          {!connected && (
            <div className="bg-yellow-500/20 border border-yellow-500 text-yellow-200 px-4 py-2 rounded-lg inline-block mb-4">
              Connecting to server...
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-500/20 border border-red-500 text-red-200 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        {/* Session Invitations */}
        {invitations.length > 0 && !currentSession && (
          <div className="mb-6 glass-effect rounded-2xl p-6">
            <h3 className="text-xl font-semibold mb-4">Session Invitations</h3>
            <div className="space-y-3">
              {invitations.map((invitation) => (
                <div
                  key={invitation.id}
                  className="bg-glass rounded-xl p-4 flex items-center justify-between"
                >
                  <div>
                    <div className="font-semibold">{invitation.session_name}</div>
                    <div className="text-sm text-gray-400">
                      Invited by {invitation.inviter_username}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleAcceptInvitation(invitation)}
                      className="bg-primary hover:bg-green-600 text-white px-4 py-2 rounded-xl transition-colors"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => handleRejectInvitation(invitation.id)}
                      className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-xl transition-colors"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {currentSession ? (
          <div className="mb-6 glass-effect rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-2xl font-semibold">{currentSession.name}</h2>
                <p className="text-gray-400">{currentSession.description || 'No description'}</p>
                <div className="flex items-center gap-4 mt-2">
                  <span className="flex items-center gap-2 text-sm text-gray-400">
                    <Users className="w-4 h-4" />
                    {currentSession.members?.length || 0} members
                  </span>
                  <span className="text-sm text-gray-400">
                    Host: {currentSession.host_username}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {currentSession.host_id === user?.id && (
                  <button
                    onClick={() => setShowInviteModal(true)}
                    className="bg-primary hover:bg-green-600 text-white px-6 py-2 rounded-xl transition-colors flex items-center gap-2"
                  >
                    <UserPlus className="w-4 h-4" />
                    Invite Friends
                  </button>
                )}
                {currentSession.host_id === user?.id ? (
                  <button
                    onClick={handleDeleteSession}
                    className="bg-red-500 hover:bg-red-600 text-white px-6 py-2 rounded-xl transition-colors"
                  >
                    Delete Session
                  </button>
                ) : (
                  <button
                    onClick={handleLeaveSession}
                    className="bg-red-500 hover:bg-red-600 text-white px-6 py-2 rounded-xl transition-colors"
                  >
                    Leave Session
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-4 mb-8">
            <button 
              onClick={handleStartJamClick}
              disabled={loading || !connected}
              className="flex-1 bg-accent hover:bg-blue-500 text-white py-3 px-6 rounded-xl font-semibold transition-all duration-300 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Creating...' : 'Start Jam'}
            </button>
            <div className="flex-1 flex gap-2">
              <input
                type="text"
                placeholder="Enter session ID"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value)}
                className="flex-1 bg-glass border border-gray-600 rounded-xl px-4 py-3 focus:outline-none focus:border-primary"
              />
              <button 
                onClick={handleJoinJam}
                disabled={loading || !connected}
                className="bg-primary hover:bg-green-600 text-white px-6 py-3 rounded-xl font-semibold transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Joining...' : 'Join Session'}
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2">
            {sessions.length > 0 && !currentSession && (
              <div className="mb-8">
                <h2 className="text-2xl font-semibold mb-4">Available Sessions</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {sessions.slice(0, 6).map((session) => (
                    <motion.div
                      key={session.id}
                      whileHover={{ scale: 1.02 }}
                      className="bg-secondary rounded-2xl p-4 cursor-pointer hover:shadow-2xl transition-all duration-300"
                      onClick={() => handleSessionCardClick(session)}
                    >
                      <h3 className="font-semibold text-lg mb-1">{session.name}</h3>
                      <p className="text-gray-400 text-sm mb-2">{session.description || 'No description'}</p>
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span>{session.members?.length || 0} members</span>
                        <span>{session.host_username}</span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {currentSession && (
              <>
                {/* Pending Requests (Host View) */}
                {currentSession.host_id === user?.id && sessionRequests.length > 0 && (
                  <div className="glass-effect rounded-2xl p-6 mb-8">
                    <h3 className="text-xl font-semibold mb-4">Pending Requests</h3>
                    <div className="space-y-3">
                      {sessionRequests.map((request) => (
                        <div
                          key={request.id}
                          className="bg-glass rounded-xl p-4 flex items-center justify-between"
                        >
                          <div>
                            <div className="font-semibold">{request.requester_username}</div>
                            <div className="text-sm text-gray-400">wants to join your session</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleAcceptRequest(request)}
                              className="bg-primary hover:bg-green-600 text-white px-4 py-2 rounded-xl transition-colors flex items-center gap-2"
                            >
                              <Check className="w-4 h-4" />
                              Accept
                            </button>
                            <button
                              onClick={() => handleDeclineRequest(request.id)}
                              className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-xl transition-colors flex items-center gap-2"
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

                <div className="glass-effect rounded-2xl p-6 mb-8">
                  <h3 className="text-xl font-semibold mb-4">Now Playing</h3>
                {currentSession.track_name ? (
                  <div>
                    <h4 className="text-lg font-semibold">{currentSession.track_name}</h4>
                    <p className="text-gray-400">{currentSession.track_artist}</p>
                    <div className="mt-4">
                      <button
                        onClick={handlePlayPause}
                        className="bg-primary hover:bg-green-600 text-white px-6 py-2 rounded-xl transition-colors flex items-center gap-2"
                      >
                        {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                        {isPlaying ? 'Pause' : 'Play'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-gray-400">No track selected</p>
                )}
                </div>
              </>
            )}
          </div>

          {/* Chat Sidebar */}
          {currentSession && (
            <div className="glass-effect rounded-2xl p-6 flex flex-col" style={{ height: '600px' }}>
              <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <MessageCircle className="w-5 h-5" />
                Group Chat
                <span className="text-sm text-gray-400 font-normal">
                  ({currentSession.members?.length || 0} members)
                </span>
              </h3>
              <div className="flex-1 overflow-y-auto mb-4 space-y-3 pr-2">
                {messages.length === 0 ? (
                  <p className="text-gray-400 text-center py-8">No messages yet. Start the conversation!</p>
                ) : (
                  messages.map((msg, idx) => {
                    const isCurrentUser = msg.type === 'user' && msg.username === user?.username;
                    return (
                      <div
                        key={idx}
                        className={`rounded-xl p-3 ${
                          msg.type === 'system' 
                            ? 'text-center text-gray-400 text-sm bg-glass/50' 
                            : isCurrentUser
                            ? 'bg-primary/20 ml-4'
                            : 'bg-glass mr-4'
                        }`}
                      >
                        {msg.type === 'user' && (
                          <div className={`font-semibold mb-1 ${
                            isCurrentUser ? 'text-primary' : 'text-accent'
                          }`}>
                            {isCurrentUser ? 'You' : msg.username}
                          </div>
                        )}
                        <div className="text-white">{msg.message}</div>
                        {msg.timestamp && (
                          <div className="text-xs text-gray-500 mt-1">{formatTime(msg.timestamp)}</div>
                        )}
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>
              <form onSubmit={handleSendMessage} className="flex gap-2 mt-auto">
                <input
                  type="text"
                  placeholder="Type a message..."
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  disabled={!connected || !currentSessionId}
                  className="flex-1 bg-darker border border-gray-600 rounded-xl px-4 py-2 focus:outline-none focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <button
                  type="submit"
                  disabled={!connected || !currentSessionId || !messageInput.trim()}
                  className="bg-primary hover:bg-green-600 text-white px-4 py-2 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Send
                </button>
              </form>
            </div>
          )}
        </div>
      </div>

      {currentSong && (
        <MiniPlayer
          currentSong={currentSong}
          isPlaying={isPlaying}
          onPlayPause={handlePlayPause}
          onNext={() => {}}
          onPrevious={() => {}}
        />
      )}

      <PrivacyTypeModal
        isOpen={showPrivacyModal}
        onClose={() => setShowPrivacyModal(false)}
        onSelect={handleStartJam}
      />

      <InviteFriendsModal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        sessionId={currentSession?.id}
        onInvite={handleInviteFriend}
      />

      <RequestSessionModal
        isOpen={showRequestModal}
        onClose={() => {
          setShowRequestModal(false);
          setSelectedSession(null);
        }}
        session={selectedSession}
        onRequest={handleSendRequest}
      />
    </div>
  );
};

export default StreamSongsPage;
