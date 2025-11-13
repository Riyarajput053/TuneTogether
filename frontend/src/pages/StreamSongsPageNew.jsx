import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { 
  Music, Playlist, Sparkles, Search, Users, MessageCircle, 
  Play, Pause, LogOut as LeaveIcon, Settings
} from 'lucide-react';
import MusicPlayer from '../components/MusicPlayer';
import PlaylistBrowser from '../components/PlaylistBrowser';
import Recommendations from '../components/Recommendations';
import Explore from '../components/Explore';
import PrivacyTypeModal from '../components/PrivacyTypeModal';
import InviteFriendsModal from '../components/InviteFriendsModal';
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
  const [invitations, setInvitations] = useState([]);
  const [spotifyConnected, setSpotifyConnected] = useState(false);
  
  const positionUpdateIntervalRef = useRef(null);
  const messagesEndRef = useRef(null);

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

  // Load sessions and invitations
  useEffect(() => {
    if (user) {
      loadSessions();
      loadInvitations();
      const interval = setInterval(() => {
        loadSessions();
        loadInvitations();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [user]);

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
        if (updates.track_id && currentSession && user?.id !== currentSession.host_id) {
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

    socket.on('session_updated', handleSessionUpdate);

    return () => {
      socket.off('session_updated', handleSessionUpdate);
    };
  }, [socket, currentSessionId, currentSession, user, syncToPosition]);

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
    
    if (currentSession && user?.id === currentSession.host_id) {
      // Host plays track and updates session
      if (isReady) {
        const trackUri = `spotify:track:${track.id}`;
        await playTrack(trackUri, 0);
        
        // Update session
        updateSession({
          track_id: track.id,
          track_name: track.name,
          track_artist: track.artist,
          position_ms: 0,
          is_playing: true,
        });
      }
    } else if (!currentSession) {
      // No session, just play locally
      if (isReady) {
        const trackUri = `spotify:track:${track.id}`;
        await playTrack(trackUri, 0);
      }
    }
  }, [currentSession, user, isReady, playTrack, updateSession]);

  // Load functions
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
        await loadSessions();
      }
    } catch (err) {
      console.error('Error creating session:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleJoinSession = async (sessionId) => {
    try {
      const session = await api.getSession(sessionId);
      if (connected) {
        await joinSession(sessionId);
        setCurrentSession(session);
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
      setMessages([]);
    }
  };

  const handleSendMessage = () => {
    if (!messageInput.trim() || !currentSessionId) return;
    sendMessage(messageInput);
    setMessageInput('');
  };

  const isHost = currentSession && user?.id === currentSession.host_id;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900">
      <div className="container mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Sidebar - Sessions & Chat */}
          <div className="lg:col-span-1 space-y-6">
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
                  sessions.map((session) => (
                    <button
                      key={session.id}
                      onClick={() => handleJoinSession(session.id)}
                      className={`w-full text-left p-3 rounded-lg transition-colors ${
                        currentSession?.id === session.id
                          ? 'bg-green-600/20 border border-green-600'
                          : 'hover:bg-gray-700/50'
                      }`}
                    >
                      <p className="text-white font-medium text-sm">{session.name}</p>
                      <p className="text-gray-400 text-xs">
                        {session.host_username} • {session.members?.length || 0} members
                      </p>
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Current Session Info */}
            {currentSession && (
              <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl p-6 border border-gray-700">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-white font-semibold">{currentSession.name}</h3>
                  <button
                    onClick={handleLeaveSession}
                    className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
                  >
                    <LeaveIcon className="w-5 h-5 text-gray-400" />
                  </button>
                </div>
                {isHost && (
                  <button
                    onClick={() => setShowInviteModal(true)}
                    className="w-full px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors mb-4"
                  >
                    Invite Friends
                  </button>
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
                      <Playlist className="w-5 h-5" />
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
      />
    </div>
  );
};

export default StreamSongsPage;

