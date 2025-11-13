import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { 
  Music, ListMusic, Sparkles, Search, Users, MessageCircle, 
  Play, Pause, LogOut as LeaveIcon, Settings, Trash2
} from 'lucide-react';
import MusicPlayer from '../components/MusicPlayer';
import PlaylistBrowser from '../components/PlaylistBrowser';
import Recommendations from '../components/Recommendations';
import Explore from '../components/Explore';
import PrivacyTypeModal from '../components/PrivacyTypeModal';
import InviteFriendsModal from '../components/InviteFriendsModal';
import RequestSessionModal from '../components/RequestSessionModal';
import { api } from '../utils/api';
import { useSocket } from '../contexts/SocketContext';
import { useAuth } from '../contexts/AuthContext';
import { useSpotify } from '../contexts/SpotifyContext';

const StreamSongsPage = () => {
  const { user } = useAuth();
  const location = useLocation();
  const { socket, connected, joinSession, leaveSession, sendMessage, currentSessionId, updateSession } = useSocket();
  const { 
    isReady, isPlaying, currentTrack, position, initializePlayer, 
    syncToPosition, playTrack, pause, resume 
  } = useSpotify();

  // UI State
  const [activeTab, setActiveTab] = useState('explore'); // explore, playlists, recommendations
  const [currentSong, setCurrentSong] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [currentSession, setCurrentSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [selectedSession, setSelectedSession] = useState(null);
  const [invitations, setInvitations] = useState([]);
  const [sessionRequests, setSessionRequests] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [spotifyConnected, setSpotifyConnected] = useState(false);
  
  const positionUpdateIntervalRef = useRef(null);
  const messagesEndRef = useRef(null);

  // Load functions - defined early so they can be used in useEffect hooks
  const loadSessions = useCallback(async () => {
    try {
      const data = await api.getSessions();
      setSessions(data);
    } catch (err) {
      console.error('Error loading sessions:', err);
    }
  }, []);

  const loadInvitations = useCallback(async () => {
    try {
      const data = await api.getSessionInvitations();
      setInvitations(data);
    } catch (err) {
      console.error('Error loading invitations:', err);
    }
  }, []);

  const loadSessionRequests = useCallback(async (sessionId) => {
    if (!sessionId) return;
    try {
      const data = await api.getSessionRequests(sessionId);
      setSessionRequests(data);
    } catch (err) {
      console.error('Error loading session requests:', err);
    }
  }, []);

  const loadNotifications = useCallback(async () => {
    try {
      const data = await api.getUnreadNotifications();
      setNotifications(data);
    } catch (err) {
      console.error('Error loading notifications:', err);
    }
  }, []);

  // Initialize Spotify player
  useEffect(() => {
    const initSpotify = async () => {
      try {
        const status = await api.getSpotifyStatus();
        if (status.connected) {
          setSpotifyConnected(true);
          await initializePlayer();
        }
      } catch (error) {
        console.error('Error initializing Spotify:', error);
      }
    };
    
    if (user) {
      initSpotify();
    }
  }, [user, initializePlayer]);

  // Load sessions, invitations, and notifications
  useEffect(() => {
    if (user) {
      loadSessions();
      loadInvitations();
      loadNotifications();
      const interval = setInterval(() => {
        loadSessions();
        loadInvitations();
        loadNotifications();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [user, loadSessions, loadInvitations, loadNotifications]);

  // Load session requests when host is in a session
  useEffect(() => {
    const isHost = currentSession && user?.id === currentSession.host_id;
    if (currentSession && isHost) {
      loadSessionRequests(currentSession.id);
      const interval = setInterval(() => {
        loadSessionRequests(currentSession.id);
      }, 3000);
      return () => clearInterval(interval);
    } else {
      setSessionRequests([]);
    }
  }, [currentSession, user, loadSessionRequests]);

  // Handle session updates from socket
  useEffect(() => {
    if (!socket) return;

    const handleSessionUpdate = (data) => {
      if (data.session_id === currentSessionId) {
        const updates = data.updates;
        
        // Update current session state
        setCurrentSession((prev) => ({
          ...prev,
          ...updates
        }));

        // If host updated track, sync guests
        if (updates.track_id && currentSession && user?.id !== currentSession.host_id && isReady) {
          const trackUri = `spotify:track:${updates.track_id}`;
          syncToPosition(
            trackUri,
            updates.position_ms || 0,
            updates.is_playing || false
          );
        }

        // Update current song
        if (updates.track_id) {
          setCurrentSong({
            id: updates.track_id,
            name: updates.track_name,
            artist: updates.track_artist,
            position_ms: updates.position_ms || 0,
          });
        }
      }
    };

    const handleUserJoined = (data) => {
      setMessages((prev) => [
        ...prev,
        {
          username: data.username,
          message: `${data.username} joined the session`,
          timestamp: new Date()
        }
      ]);
    };

    const handleUserLeft = (data) => {
      setMessages((prev) => [
        ...prev,
        {
          username: data.username,
          message: `${data.username} left the session`,
          timestamp: new Date()
        }
      ]);
    };

    const handleChatMessage = (data) => {
      // Check if this is our own message (already added optimistically)
      // If it's from the current user, we might have already added it, but we'll add it anyway
      // to ensure consistency (the server timestamp is authoritative)
      setMessages((prev) => {
        // Check if we already have this message (to avoid duplicates)
        const messageExists = prev.some(
          msg => msg.username === data.username && 
                 msg.message === data.message &&
                 Math.abs(new Date(msg.timestamp).getTime() - new Date(data.timestamp || Date.now()).getTime()) < 2000
        );
        
        if (messageExists) {
          // Message already exists, just return previous state
          return prev;
        }
        
        // Add new message
        return [
          ...prev,
          {
            username: data.username,
            message: data.message,
            timestamp: new Date(data.timestamp || Date.now())
          }
        ];
      });
    };

    const handleSessionInvitation = () => {
      // Reload invitations when a new one is received
      loadInvitations();
    };

    const handleSessionRequest = () => {
      // Reload session requests when a new one is received (if host)
      if (currentSession && user?.id === currentSession.host_id) {
        loadSessionRequests(currentSession.id);
      }
    };

    const handleNotification = () => {
      // Reload notifications when a new one is received
      loadNotifications();
    };

    socket.on('session_updated', handleSessionUpdate);
    socket.on('user_joined', handleUserJoined);
    socket.on('user_left', handleUserLeft);
    socket.on('chat:message', handleChatMessage);
    socket.on('session_invitation', handleSessionInvitation);
    socket.on('session_request', handleSessionRequest);
    socket.on('notification', handleNotification);

    return () => {
      socket.off('session_updated', handleSessionUpdate);
      socket.off('user_joined', handleUserJoined);
      socket.off('user_left', handleUserLeft);
      socket.off('chat:message', handleChatMessage);
      socket.off('session_invitation', handleSessionInvitation);
      socket.off('session_request', handleSessionRequest);
      socket.off('notification', handleNotification);
    };
  }, [socket, currentSessionId, currentSession, user, syncToPosition, isReady, loadInvitations, loadSessionRequests, loadNotifications]);

  // Scroll messages to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Host: Send position updates to guests
  useEffect(() => {
    if (!currentSession || !user || user.id !== currentSession.host_id) {
      if (positionUpdateIntervalRef.current) {
        clearInterval(positionUpdateIntervalRef.current);
        positionUpdateIntervalRef.current = null;
      }
      return;
    }

    // Host sends position updates every second
    positionUpdateIntervalRef.current = setInterval(() => {
      if (currentTrack && isReady && currentSessionId) {
        updateSession({
          track_id: currentTrack.id,
          track_name: currentTrack.name,
          track_artist: currentTrack.artist,
          position_ms: position,
          is_playing: isPlaying,
        });
      }
    }, 1000);

    return () => {
      if (positionUpdateIntervalRef.current) {
        clearInterval(positionUpdateIntervalRef.current);
      }
    };
  }, [currentSession, user, currentTrack, position, isPlaying, isReady, currentSessionId, updateSession]);

  // Handle track selection
  const handleTrackSelect = useCallback(async (track) => {
    setCurrentSong(track);
    
    // Use track.uri if available, otherwise construct it
    const trackUri = track.uri || `spotify:track:${track.id}`;
    
    if (currentSession && user?.id === currentSession.host_id) {
      // Host plays track and updates session
      if (isReady) {
        try {
          await playTrack(trackUri, 0);
          
          // Update session
          updateSession({
            track_id: track.id,
            track_name: track.name,
            track_artist: track.artist,
            position_ms: 0,
            is_playing: true,
          });
        } catch (error) {
          console.error('Error playing track:', error);
        }
      } else {
        console.warn('Spotify player not ready');
      }
    } else if (!currentSession) {
      // No session, just play locally
      if (isReady) {
        try {
          await playTrack(trackUri, 0);
        } catch (error) {
          console.error('Error playing track:', error);
        }
      } else {
        console.warn('Spotify player not ready');
      }
    }
  }, [currentSession, user, isReady, playTrack, updateSession]);


  const handleStartJam = () => {
    if (!user) return;
    setShowPrivacyModal(true);
  };

  const handleCreateSession = async (privacyType) => {
    setShowPrivacyModal(false);
    setLoading(true);
    try {
      const sessionData = {
        name: `${user.username}'s Jam Session`,
        description: 'Join me for some great music!',
        platform: 'spotify',
        privacy_type: privacyType
      };
      const newSession = await api.createSession(sessionData);
      if (connected) {
        await joinSession(newSession.id);
        setCurrentSession(newSession);
        setMessages([]); // New session, no messages yet
        await loadSessions();
      }
    } catch (err) {
      console.error('Error creating session:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadSessionMessages = useCallback(async (sessionId) => {
    if (!sessionId) return;
    try {
      const data = await api.getSessionMessages(sessionId);
      // Convert API response to message format
      const formattedMessages = data.map(msg => ({
        username: msg.username,
        message: msg.message,
        timestamp: new Date(msg.timestamp)
      }));
      setMessages(formattedMessages);
    } catch (err) {
      console.error('Error loading session messages:', err);
    }
  }, []);

  const handleJoinSession = async (sessionId) => {
    try {
      const session = await api.getSession(sessionId);
      if (connected) {
        await joinSession(sessionId);
        setCurrentSession(session);
        // Load chat history
        await loadSessionMessages(sessionId);
        if (session.track_id) {
          setCurrentSong({
            id: session.track_id,
            name: session.track_name,
            artist: session.track_artist,
            position_ms: session.position_ms || 0,
          });
        }
      }
    } catch (err) {
      console.error('Error joining session:', err);
    }
  };

  const handleLeaveSession = async () => {
    if (currentSessionId) {
      await leaveSession(currentSessionId);
      setCurrentSession(null);
      setCurrentSong(null);
      setMessages([]); // Clear messages when leaving
    }
  };

  const handleDeleteSession = async () => {
    if (!currentSession || !isHost) return;

    if (!window.confirm('Are you sure you want to delete this session? This action cannot be undone.')) {
      return;
    }

    try {
      // Leave socket session first
      if (currentSessionId) {
        await leaveSession(currentSessionId);
      }
      // Delete session via API
      await api.deleteSession(currentSession.id);
      // Clear state
      setCurrentSession(null);
      setCurrentSong(null);
      setMessages([]);
      // Reload sessions list
      await loadSessions();
    } catch (err) {
      console.error('Error deleting session:', err);
      // Clear state even on error
      setCurrentSession(null);
      setCurrentSong(null);
      setMessages([]);
    }
  };

  const handleSendMessage = () => {
    if (!messageInput.trim() || !currentSessionId || !user) return;
    
    const messageText = messageInput.trim();
    
    // Add message to local state immediately for instant feedback
    setMessages((prev) => [
      ...prev,
      {
        username: user.username,
        message: messageText,
        timestamp: new Date()
      }
    ]);
    
    // Clear input
    setMessageInput('');
    
    // Send message via socket
    sendMessage(messageText);
  };

  const handleInviteFriend = async (friendId, sessionId) => {
    try {
      await api.inviteFriendToSession(sessionId, friendId);
      // Reload invitations to show updated state
      await loadInvitations();
    } catch (err) {
      console.error('Error inviting friend:', err);
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
        // Load chat history
        await loadSessionMessages(session.id);
        if (session.track_id) {
          setCurrentSong({
            id: session.track_id,
            name: session.track_name,
            artist: session.track_artist,
            position_ms: session.position_ms || 0,
          });
        }
      }
      await loadInvitations();
      await loadSessions();
    } catch (err) {
      console.error('Error accepting invitation:', err);
    }
  };

  const handleRejectInvitation = async (invitationId) => {
    try {
      await api.rejectSessionInvitation(invitationId);
      await loadInvitations();
    } catch (err) {
      console.error('Error rejecting invitation:', err);
    }
  };

  const handleRequestToJoin = async (sessionId) => {
    try {
      await api.requestToJoinSession(sessionId);
      setShowRequestModal(false);
      setSelectedSession(null);
      await loadSessions();
    } catch (err) {
      console.error('Error requesting to join:', err);
      alert(err.message || 'Failed to send request');
    }
  };

  const handleAcceptRequest = async (requestId) => {
    if (!currentSession) return;
    try {
      const updatedSession = await api.acceptSessionRequest(currentSession.id, requestId);
      setCurrentSession(updatedSession);
      await loadSessionRequests(currentSession.id);
      await loadSessions();
      // Messages are already loaded, no need to reload
    } catch (err) {
      console.error('Error accepting request:', err);
    }
  };

  const handleDeclineRequest = async (requestId) => {
    if (!currentSession) return;
    try {
      await api.declineSessionRequest(currentSession.id, requestId);
      await loadSessionRequests(currentSession.id);
    } catch (err) {
      console.error('Error declining request:', err);
    }
  };

  const handleSessionCardClick = (session) => {
    // Check if user can join directly or needs to request
    const isHost = session.host_id === user?.id;
    const isMember = session.members?.some(m => m.user_id === user?.id);
    
    if (isHost || isMember) {
      // Can join directly
      handleJoinSession(session.id);
    } else if (session.privacy_type === 'public' || session.privacy_type === 'friends') {
      // Need to request to join
      setSelectedSession(session);
      setShowRequestModal(true);
    } else {
      // Private session - can't join without invitation
      alert('This is a private session. You need to be invited to join.');
    }
  };

  const handleMarkNotificationRead = async (notificationId) => {
    try {
      await api.markNotificationRead(notificationId);
      await loadNotifications();
    } catch (err) {
      console.error('Error marking notification as read:', err);
    }
  };

  const isHost = currentSession && user?.id === currentSession.host_id;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900">
      <div className="container mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Sidebar - Sessions & Chat */}
          <div className="lg:col-span-1 space-y-6">
            {/* Notifications */}
            {notifications.length > 0 && (
              <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl p-6 border border-gray-700">
                <h3 className="text-white font-semibold text-lg mb-4">Notifications ({notifications.length})</h3>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {notifications.map((notification) => (
                    <div
                      key={notification.id}
                      onClick={() => {
                        handleMarkNotificationRead(notification.id);
                        if (notification.session_id) {
                          handleJoinSession(notification.session_id);
                        }
                      }}
                      className="bg-gray-700/50 rounded-lg p-3 cursor-pointer hover:bg-gray-700/70 transition-colors"
                    >
                      <div className="font-semibold text-white text-sm">{notification.title}</div>
                      <div className="text-xs text-gray-400 mt-1">{notification.message}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Session Invitations */}
            {invitations.length > 0 && !currentSession && (
              <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl p-6 border border-gray-700">
                <h3 className="text-white font-semibold text-lg mb-4">Session Invitations</h3>
                <div className="space-y-3">
                  {invitations.map((invitation) => (
                    <div
                      key={invitation.id}
                      className="bg-gray-700/50 rounded-xl p-4 flex items-center justify-between"
                    >
                      <div>
                        <div className="font-semibold text-white text-sm">{invitation.session_name}</div>
                        <div className="text-xs text-gray-400">
                          Invited by {invitation.inviter_username}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleAcceptInvitation(invitation)}
                          className="bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg text-xs transition-colors"
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => handleRejectInvitation(invitation.id)}
                          className="bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg text-xs transition-colors"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sessions List */}
            <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl p-6 border border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-white font-semibold text-lg flex items-center space-x-2">
                  <Users className="w-5 h-5" />
                  <span>Jam Sessions</span>
                </h2>
                <button
                  onClick={handleStartJam}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Start Jam
                </button>
              </div>
              
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {sessions.length === 0 ? (
                  <p className="text-gray-400 text-sm">No active sessions</p>
                ) : (
                  sessions.map((session) => {
                    const isHost = session.host_id === user?.id;
                    const isMember = session.members?.some(m => m.user_id === user?.id);
                    const canJoinDirectly = isHost || isMember;
                    
                    return (
                      <button
                        key={session.id}
                        onClick={() => handleSessionCardClick(session)}
                        className={`w-full text-left p-3 rounded-lg transition-colors ${
                          currentSession?.id === session.id
                            ? 'bg-green-600/20 border border-green-600'
                            : 'hover:bg-gray-700/50'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-white font-medium text-sm">{session.name}</p>
                            <p className="text-gray-400 text-xs">
                              {session.host_username} • {session.members?.length || 0} members
                            </p>
                          </div>
                          {!canJoinDirectly && (session.privacy_type === 'public' || session.privacy_type === 'friends') && (
                            <span className="text-xs text-yellow-400">Request</span>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Current Session Info */}
            {currentSession && (
              <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl p-6 border border-gray-700">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-white font-semibold">{currentSession.name}</h3>
                  <div className="flex items-center space-x-2">
                    {isHost && (
                      <button
                        onClick={handleDeleteSession}
                        className="p-2 hover:bg-red-600/20 rounded-lg transition-colors"
                        title="Delete Session"
                      >
                        <Trash2 className="w-5 h-5 text-red-400" />
                      </button>
                    )}
                    <button
                      onClick={handleLeaveSession}
                      className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
                      title={isHost ? "Leave Session" : "Leave Session"}
                    >
                      <LeaveIcon className="w-5 h-5 text-gray-400" />
                    </button>
                  </div>
                </div>
                {isHost && (
                  <>
                    <button
                      onClick={() => setShowInviteModal(true)}
                      className="w-full px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors mb-4"
                    >
                      Invite Friends
                    </button>
                    
                    {/* Pending Requests */}
                    {sessionRequests.length > 0 && (
                      <div className="mb-4">
                        <h4 className="text-white font-medium text-sm mb-2">Pending Requests ({sessionRequests.length})</h4>
                        <div className="space-y-2 max-h-32 overflow-y-auto">
                          {sessionRequests.map((request) => (
                            <div
                              key={request.id}
                              className="bg-gray-700/50 rounded-lg p-2 flex items-center justify-between"
                            >
                              <span className="text-white text-xs">{request.requester_username}</span>
                              <div className="flex gap-1">
                                <button
                                  onClick={() => handleAcceptRequest(request.id)}
                                  className="bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded text-xs"
                                >
                                  Accept
                                </button>
                                <button
                                  onClick={() => handleDeclineRequest(request.id)}
                                  className="bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded text-xs"
                                >
                                  Decline
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
                
                {/* Chat */}
                <div className="border-t border-gray-700 pt-4 mt-4">
                  <div className="flex items-center space-x-2 mb-2">
                    <MessageCircle className="w-4 h-4 text-gray-400" />
                    <h4 className="text-white font-medium text-sm">Chat</h4>
                  </div>
                  <div className="h-32 overflow-y-auto mb-2 space-y-1">
                    {messages.map((msg, idx) => (
                      <div key={idx} className="text-xs">
                        <span className="text-gray-400">{msg.username}: </span>
                        <span className="text-gray-300">{msg.message}</span>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      value={messageInput}
                      onChange={(e) => setMessageInput(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                      placeholder="Type a message..."
                      className="flex-1 px-3 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:border-green-500"
                    />
                    <button
                      onClick={handleSendMessage}
                      className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-sm"
                    >
                      Send
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Main Content - Music Player & Browse */}
          <div className="lg:col-span-2 space-y-6">
            {/* Music Player */}
            {spotifyConnected && (
              <MusicPlayer
                track={currentSong}
                isHost={isHost}
                onPositionUpdate={(pos) => {
                  if (isHost && currentSessionId) {
                    updateSession({ position_ms: pos });
                  }
                }}
              />
            )}

            {!spotifyConnected && (
              <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl p-8 border border-gray-700 text-center">
                <Music className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                <p className="text-gray-400 mb-4">Connect your Spotify account to start jamming</p>
                <a
                  href="/profile"
                  className="inline-block px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
                >
                  Connect Spotify
                </a>
              </div>
            )}

            {/* Tabs */}
            {spotifyConnected && (
              <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl border border-gray-700">
                <div className="flex border-b border-gray-700">
                  <button
                    onClick={() => setActiveTab('explore')}
                    className={`flex-1 px-6 py-4 font-medium transition-colors ${
                      activeTab === 'explore'
                        ? 'text-white border-b-2 border-green-500'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center justify-center space-x-2">
                      <Search className="w-5 h-5" />
                      <span>Explore</span>
                    </div>
                  </button>
                  <button
                    onClick={() => setActiveTab('playlists')}
                    className={`flex-1 px-6 py-4 font-medium transition-colors ${
                      activeTab === 'playlists'
                        ? 'text-white border-b-2 border-green-500'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center justify-center space-x-2">
                      <ListMusic className="w-5 h-5" />
                      <span>Playlists</span>
                    </div>
                  </button>
                  <button
                    onClick={() => setActiveTab('recommendations')}
                    className={`flex-1 px-6 py-4 font-medium transition-colors ${
                      activeTab === 'recommendations'
                        ? 'text-white border-b-2 border-green-500'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center justify-center space-x-2">
                      <Sparkles className="w-5 h-5" />
                      <span>For You</span>
                    </div>
                  </button>
                </div>

                <div className="h-96 overflow-y-auto">
                  {activeTab === 'explore' && <Explore onTrackSelect={handleTrackSelect} />}
                  {activeTab === 'playlists' && <PlaylistBrowser onTrackSelect={handleTrackSelect} />}
                  {activeTab === 'recommendations' && <Recommendations onTrackSelect={handleTrackSelect} />}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      <PrivacyTypeModal
        isOpen={showPrivacyModal}
        onClose={() => setShowPrivacyModal(false)}
        onSelect={handleCreateSession}
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
        onRequest={handleRequestToJoin}
      />
    </div>
  );
};

export default StreamSongsPage;

