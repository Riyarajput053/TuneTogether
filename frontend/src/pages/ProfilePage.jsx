import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../utils/api';
import { User, Mail, Calendar, LogOut, Music, CheckCircle, XCircle } from 'lucide-react';

export default function ProfilePage() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isConnecting, setIsConnecting] = useState(false);
  const [spotifyStatus, setSpotifyStatus] = useState(null);
  const [spotifyConnected, setSpotifyConnected] = useState(false);
  const [checkingSpotify, setCheckingSpotify] = useState(true);

  useEffect(() => {
    if (!loading && !user) {
      navigate('/login');
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    // Check Spotify connection status when component loads
    const checkSpotifyStatus = async () => {
      if (!user) return;
      try {
        const status = await api.getSpotifyStatus();
        setSpotifyConnected(status.connected);
      } catch (error) {
        console.error('Error checking Spotify status:', error);
        setSpotifyConnected(false);
      } finally {
        setCheckingSpotify(false);
      }
    };

    if (user) {
      checkSpotifyStatus();
    }
  }, [user]);

  useEffect(() => {
    // Check for Spotify connection status in URL params
    const connected = searchParams.get('spotify_connected');
    const error = searchParams.get('spotify_error');
    
    if (connected === 'true') {
      setSpotifyStatus({ type: 'success', message: 'Successfully connected to Spotify!' });
      setSpotifyConnected(true);
      // Clear the query parameter
      searchParams.delete('spotify_connected');
      setSearchParams(searchParams, { replace: true });
      // Clear message after 5 seconds
      setTimeout(() => setSpotifyStatus(null), 5000);
      // Refresh Spotify status
      api.getSpotifyStatus().then(status => {
        setSpotifyConnected(status.connected);
      }).catch(console.error);
    } else if (error) {
      const errorMessages = {
        missing_parameters: 'Missing required parameters. Please try again.',
        server_configuration: 'Server configuration error. Please contact support.',
        invalid_state: 'Invalid state parameter. Please try again.',
        token_exchange_failed: 'Failed to exchange authorization code for tokens. Please try again.',
        no_access_token: 'No access token received from Spotify. Please try again.',
      };
      setSpotifyStatus({
        type: 'error',
        message: errorMessages[error] || `Error: ${error}`
      });
      // Clear the query parameter
      searchParams.delete('spotify_error');
      setSearchParams(searchParams, { replace: true });
      // Clear message after 5 seconds
      setTimeout(() => setSpotifyStatus(null), 5000);
    }
  }, [searchParams, setSearchParams]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleConnectSpotify = async () => {
    setIsConnecting(true);
    try {
      await api.connectSpotify();
    } catch (error) {
      console.error('Error connecting to Spotify:', error);
      setIsConnecting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 px-4 py-8">
      <div className="max-w-2xl mx-auto">
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl shadow-2xl p-8 border border-gray-700">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-24 h-24 bg-purple-600 rounded-full mb-4">
              <User className="w-12 h-12 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-white mb-2">Profile</h1>
            <p className="text-gray-400">Your TuneTogether account information</p>
          </div>

          <div className="space-y-6">
            {spotifyStatus && (
              <div
                className={`rounded-lg p-4 border ${
                  spotifyStatus.type === 'success'
                    ? 'bg-green-900/30 border-green-600 text-green-300'
                    : 'bg-red-900/30 border-red-600 text-red-300'
                } flex items-center space-x-2`}
              >
                {spotifyStatus.type === 'success' ? (
                  <CheckCircle className="w-5 h-5" />
                ) : (
                  <XCircle className="w-5 h-5" />
                )}
                <span>{spotifyStatus.message}</span>
              </div>
            )}

            <div className="bg-gray-700/30 rounded-lg p-6 border border-gray-600">
              <div className="flex items-center space-x-3 mb-4">
                <User className="w-5 h-5 text-purple-400" />
                <h2 className="text-lg font-semibold text-white">Username</h2>
              </div>
              <p className="text-gray-300 text-lg">{user.username}</p>
            </div>

            <div className="bg-gray-700/30 rounded-lg p-6 border border-gray-600">
              <div className="flex items-center space-x-3 mb-4">
                <Mail className="w-5 h-5 text-purple-400" />
                <h2 className="text-lg font-semibold text-white">Email</h2>
              </div>
              <p className="text-gray-300 text-lg">{user.email}</p>
            </div>

            <div className="bg-gray-700/30 rounded-lg p-6 border border-gray-600">
              <div className="flex items-center space-x-3 mb-4">
                <Calendar className="w-5 h-5 text-purple-400" />
                <h2 className="text-lg font-semibold text-white">Member Since</h2>
              </div>
              <p className="text-gray-300 text-lg">{formatDate(user.created_at)}</p>
            </div>

            <div className="bg-gray-700/30 rounded-lg p-6 border border-gray-600">
              <div className="flex items-center space-x-3 mb-4">
                <Music className="w-5 h-5 text-green-400" />
                <h2 className="text-lg font-semibold text-white">Spotify Integration</h2>
              </div>
              {checkingSpotify ? (
                <p className="text-gray-400">Checking connection status...</p>
              ) : spotifyConnected ? (
                <div className="space-y-3">
                  <div className="flex items-center space-x-2 text-green-400">
                    <CheckCircle className="w-5 h-5" />
                    <span className="font-semibold">Connected to Spotify</span>
                  </div>
                  <button
                    onClick={handleConnectSpotify}
                    disabled={isConnecting}
                    className="w-full bg-gray-600 hover:bg-gray-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold py-3 px-4 rounded-lg transition duration-200 flex items-center justify-center space-x-2"
                  >
                    <Music className="w-5 h-5" />
                    <span>{isConnecting ? 'Reconnecting...' : 'Reconnect Spotify'}</span>
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleConnectSpotify}
                  disabled={isConnecting}
                  className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold py-3 px-4 rounded-lg transition duration-200 flex items-center justify-center space-x-2"
                >
                  <Music className="w-5 h-5" />
                  <span>{isConnecting ? 'Connecting...' : 'Connect Spotify'}</span>
                </button>
              )}
            </div>

            <button
              onClick={handleLogout}
              className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-4 rounded-lg transition duration-200 flex items-center justify-center space-x-2"
            >
              <LogOut className="w-5 h-5" />
              <span>Logout</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

