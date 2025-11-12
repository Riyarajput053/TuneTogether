import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { MessageCircle, Users, Play, Pause } from 'lucide-react';
import MiniPlayer from '../components/MiniPlayer';
import { api } from '../utils/api';
import { useSocket } from '../contexts/SocketContext';
import { useAuth } from '../contexts/AuthContext';

const StreamSongsPage = () => {
  const { user } = useAuth();
  const { socket, connected, joinSession, leaveSession, sendMessage, currentSessionId } = useSocket();
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSong, setCurrentSong] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [currentSession, setCurrentSession] = useState(null);
  const [roomCode, setRoomCode] = useState('');
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    loadSessions();
  }, []);

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
      setMessages((prev) => [
        ...prev,
        {
          type: 'user',
          username: data.username,
          message: data.message,
          timestamp: new Date(data.timestamp || Date.now())
        }
      ]);
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

  const handleStartJam = async () => {
    if (!user) {
      setError('Please login to create a session');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Create session via REST API
      const sessionData = {
        name: `${user.username}'s Jam Session`,
        description: 'Join me for some great music!',
        platform: 'spotify',
        is_private: false
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
      await loadSessions();
    } catch (err) {
      setError(err.message || 'Failed to leave session');
    }
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!messageInput.trim() || !currentSessionId) return;

    try {
      sendMessage(messageInput.trim());
      setMessageInput('');
    } catch (err) {
      setError(err.message || 'Failed to send message');
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
              <button
                onClick={handleLeaveSession}
                className="bg-red-500 hover:bg-red-600 text-white px-6 py-2 rounded-xl transition-colors"
              >
                Leave Session
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-4 mb-8">
            <button 
              onClick={handleStartJam}
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
                      onClick={async () => {
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
                      }}
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
            )}
          </div>

          {/* Chat Sidebar */}
          {currentSession && (
            <div className="glass-effect rounded-2xl p-6">
              <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <MessageCircle className="w-5 h-5" />
                Group Chat
              </h3>
              <div className="h-96 overflow-y-auto mb-4 space-y-4">
                {messages.length === 0 ? (
                  <p className="text-gray-400 text-center py-8">No messages yet. Start the conversation!</p>
                ) : (
                  messages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`bg-glass rounded-xl p-3 ${
                        msg.type === 'system' ? 'text-center text-gray-400 text-sm' : ''
                      }`}
                    >
                      {msg.type === 'user' && (
                        <div className="font-semibold text-primary mb-1">{msg.username}</div>
                      )}
                      <div>{msg.message}</div>
                      {msg.timestamp && (
                        <div className="text-xs text-gray-500 mt-1">{formatTime(msg.timestamp)}</div>
                      )}
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>
              <form onSubmit={handleSendMessage} className="flex gap-2">
                <input
                  type="text"
                  placeholder="Type a message..."
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  className="flex-1 bg-darker border border-gray-600 rounded-xl px-4 py-2 focus:outline-none focus:border-primary"
                />
                <button
                  type="submit"
                  className="bg-primary hover:bg-green-600 text-white px-4 py-2 rounded-xl transition-colors"
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
    </div>
  );
};

export default StreamSongsPage;
