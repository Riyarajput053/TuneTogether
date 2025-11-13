import { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { api } from '../utils/api';

const SpotifyContext = createContext(null);

export const useSpotify = () => {
  const context = useContext(SpotifyContext);
  if (!context) {
    throw new Error('useSpotify must be used within a SpotifyProvider');
  }
  return context;
};

export const SpotifyProvider = ({ children }) => {
  const [player, setPlayer] = useState(null);
  const [deviceId, setDeviceId] = useState(null);
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(50);
  const [isPaused, setIsPaused] = useState(true);
  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState(null);
  const [queue, setQueue] = useState([]);
  const [currentQueueIndex, setCurrentQueueIndex] = useState(-1);
  const [autoplay, setAutoplay] = useState(true);
  const tokenRef = useRef(null);
  const positionIntervalRef = useRef(null);
  const previousPositionRef = useRef(0);

  // Load Spotify Web Playback SDK
  useEffect(() => {
    if (window.Spotify) {
      return; // Already loaded
    }

    const script = document.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.async = true;
    document.body.appendChild(script);

    window.onSpotifyWebPlaybackSDKReady = () => {
      console.log('Spotify Web Playback SDK ready');
    };

    return () => {
      // Cleanup if needed
    };
  }, []);

  // Get available devices
  const getAvailableDevices = useCallback(async () => {
    if (!tokenRef.current) {
      return [];
    }

    try {
      const token = tokenRef.current;
      const response = await fetch('https://api.spotify.com/v1/me/player/devices', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        return data.devices || [];
      }
      return [];
    } catch (err) {
      console.error('Error getting devices:', err);
      return [];
    }
  }, []);

  // Wait for device to be registered with Spotify (appear in devices list)
  const waitForDeviceRegistration = useCallback(async (targetDeviceId, maxAttempts = 10, delayMs = 1000) => {
    if (!tokenRef.current || !targetDeviceId) {
      return false;
    }

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const devices = await getAvailableDevices();
      const deviceFound = devices.some(device => device.id === targetDeviceId);
      
      if (deviceFound) {
        console.log(`Device registered after ${attempt + 1} attempt(s)`);
        return true;
      }
      
      if (attempt < maxAttempts - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    
    console.warn(`Device not found in devices list after ${maxAttempts} attempts`);
    return false;
  }, [getAvailableDevices]);

  // Initialize player when token is available
  const initializePlayer = useCallback(async () => {
    try {
      const tokenData = await api.getSpotifyToken();
      const token = tokenData.access_token;
      tokenRef.current = token;

      if (!window.Spotify) {
        setError('Spotify SDK not loaded');
        return;
      }

      const spotifyPlayer = new window.Spotify.Player({
        name: 'TuneTogether Player',
        getOAuthToken: (cb) => {
          cb(token);
        },
        volume: volume / 100,
      });

      // Error handling
      spotifyPlayer.addListener('initialization_error', ({ message }) => {
        console.error('Initialization error:', message);
        setError(message);
      });

      spotifyPlayer.addListener('authentication_error', ({ message }) => {
        console.error('Authentication error:', message);
        setError(message);
      });

      spotifyPlayer.addListener('account_error', ({ message }) => {
        console.error('Account error:', message);
        setError(message);
      });

      // Ready event
      spotifyPlayer.addListener('ready', ({ device_id }) => {
        console.log('Player ready with device ID:', device_id);
        setDeviceId(device_id);
        setIsActive(true);
        
        // Wait for device to be registered, then mark as ready
        (async () => {
          try {
            const token = tokenRef.current;
            if (token && device_id) {
              // Wait for device to appear in devices list (usually takes 1-3 seconds)
              const deviceRegistered = await waitForDeviceRegistration(device_id, 15, 1000);
              
              if (deviceRegistered) {
                // Device is registered, now transfer playback
                const transferResponse = await fetch('https://api.spotify.com/v1/me/player', {
                  method: 'PUT',
                  body: JSON.stringify({
                    device_ids: [device_id],
                    play: false,
                  }),
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                  },
                });
                
                if (transferResponse.ok || transferResponse.status === 204) {
                  console.log('Device registered and transfer successful - ready to play');
                  setIsReady(true);
                } else {
                  const errorText = await transferResponse.text();
                  console.warn('Transfer failed after registration:', transferResponse.status, errorText);
                  // Still mark as ready - we'll retry transfer on first play
                  setIsReady(true);
                }
              } else {
                console.warn('Device not registered yet, but marking as ready - will retry on play');
                // Mark as ready anyway - we'll handle registration in play function
                setIsReady(true);
              }
            }
          } catch (err) {
            console.warn('Error during device registration:', err);
            // Mark as ready anyway - we'll handle errors in play function
            setIsReady(true);
          }
        })();
      });

      // Not ready event
      spotifyPlayer.addListener('not_ready', ({ device_id }) => {
        console.log('Player not ready:', device_id);
        setIsReady(false);
        setIsActive(false);
      });

      // Playback state changes
      spotifyPlayer.addListener('player_state_changed', (state) => {
        if (!state) {
          return;
        }

        setIsPaused(state.paused);
        setIsPlaying(!state.paused);
        setPosition(state.position);
        setDuration(state.duration);

        // Track position for autoplay detection
        previousPositionRef.current = state.position;

        if (state.track_window?.current_track) {
          setCurrentTrack({
            id: state.track_window.current_track.id,
            name: state.track_window.current_track.name,
            artist: state.track_window.current_track.artists[0]?.name,
            album: state.track_window.current_track.album?.name,
            image: state.track_window.current_track.album?.images[0]?.url,
            uri: state.track_window.current_track.uri,
          });
        }

        // Update queue from Spotify's player state
        if (state.track_window) {
          const nextTracks = state.track_window.next_tracks || [];
          const queueTracks = nextTracks.map(track => ({
            id: track.id,
            name: track.name,
            artist: track.artists[0]?.name || 'Unknown Artist',
            album: track.album?.name,
            image: track.album?.images?.[0]?.url || track.album?.images?.[1]?.url,
            uri: track.uri,
            duration_ms: track.duration_ms,
          }));
          
          // Update queue with Spotify's actual queue
          setQueue(queueTracks);
          
          // Update current queue index based on current track
          if (state.track_window.current_track) {
            const currentUri = state.track_window.current_track.uri;
            // If we have a local queue, find the index
            // Otherwise, we're playing from Spotify's queue
            setCurrentQueueIndex(-1); // Spotify manages the queue, we just track it
          }
        }
      });

      // Connect to player
      const connected = await spotifyPlayer.connect();
      if (connected) {
        setPlayer(spotifyPlayer);
        console.log('Connected to Spotify player');
      } else {
        setError('Failed to connect to Spotify player');
      }
    } catch (err) {
      console.error('Error initializing player:', err);
      setError(err.message || 'Failed to initialize Spotify player');
    }
  }, [volume]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (player) {
        player.disconnect();
      }
      if (positionIntervalRef.current) {
        clearInterval(positionIntervalRef.current);
      }
    };
  }, [player]);

  // Transfer playback to this device - wait for registration if needed
  const transferPlayback = useCallback(async (waitForRegistration = true) => {
    if (!deviceId || !tokenRef.current) {
      throw new Error('Device ID or token not available');
    }

    if (!isReady || !player) {
      throw new Error('Player not ready for transfer');
    }

    const token = tokenRef.current;
    
    // If device not registered yet, wait for it
    if (waitForRegistration) {
      const deviceRegistered = await waitForDeviceRegistration(deviceId, 5, 1000);
      if (!deviceRegistered) {
        console.warn('Device not registered, attempting transfer anyway...');
      }
    }
    
    // Transfer playback
    const response = await fetch('https://api.spotify.com/v1/me/player', {
      method: 'PUT',
      body: JSON.stringify({
        device_ids: [deviceId],
        play: false,
      }),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok && response.status !== 204) {
      const errorText = await response.text();
      if (response.status === 404) {
        // Device still not found - return false so caller can retry
        return false;
      }
      throw new Error(`Failed to transfer playback: ${response.status} - ${errorText}`);
    }
    
    return true;
  }, [deviceId, isReady, player, waitForDeviceRegistration]);

  // Generate queue from recommendations based on current track
  const generateQueue = useCallback(async (seedTrack, limit = 20) => {
    try {
      if (!seedTrack || !seedTrack.id) {
        console.warn('No seed track provided for queue generation');
        return [];
      }

      // Validate track ID format (should be alphanumeric)
      if (!/^[a-zA-Z0-9]+$/.test(seedTrack.id)) {
        console.warn('Invalid track ID format:', seedTrack.id);
        return [];
      }

      // Use backend API endpoint for recommendations
      const data = await api.getSpotifyRecommendations({
        seed_tracks: seedTrack.id,
        limit: limit,
      });

      if (data && data.tracks && Array.isArray(data.tracks) && data.tracks.length > 0) {
        const tracks = data.tracks.map(track => ({
          id: track.id,
          name: track.name,
          artist: track.artists?.[0]?.name || 'Unknown Artist',
          album: track.album?.name,
          image: track.album?.images?.[0]?.url || track.album?.images?.[1]?.url,
          uri: track.uri,
          duration_ms: track.duration_ms,
        }));
        console.log(`Generated queue with ${tracks.length} tracks`);
        return tracks;
      }
      console.warn('No tracks returned from recommendations API');
      return [];
    } catch (err) {
      // Log the error but don't block playback
      console.warn('Error generating queue (playback will continue without queue):', err.message || err);
      return [];
    }
  }, []);

  // Add tracks to Spotify's queue using Queue API
  const addToQueue = useCallback(async (tracks) => {
    if (!deviceId || !tokenRef.current || !isReady) {
      console.warn('Cannot add to queue - player not ready');
      return;
    }

    const token = tokenRef.current;
    
    // Add each track to Spotify's queue
    for (const track of tracks) {
      const trackUri = track.uri || `spotify:track:${track.id}`;
      try {
        const response = await fetch(
          `https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(trackUri)}&device_id=${deviceId}`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (!response.ok && response.status !== 204) {
          const errorText = await response.text();
          console.warn(`Failed to add track ${trackUri} to queue:`, response.status, errorText);
        }
      } catch (err) {
        console.warn(`Error adding track ${trackUri} to queue:`, err);
      }
    }
  }, [deviceId, isReady]);

  // Clear queue
  const clearQueue = useCallback(() => {
    setQueue([]);
    setCurrentQueueIndex(-1);
  }, []);

  // Remove track from queue
  const removeFromQueue = useCallback((index) => {
    setQueue(prev => {
      const newQueue = prev.filter((_, i) => i !== index);
      if (index <= currentQueueIndex && currentQueueIndex > 0) {
        setCurrentQueueIndex(prev => prev - 1);
      }
      return newQueue;
    });
  }, [currentQueueIndex]);

  // Internal play function using Spotify Queue API
  const playTrackInternal = useCallback(async (trackUri, positionMs = 0, skipQueueGen = false) => {
    if (!player || !deviceId) {
      throw new Error('Player or device ID not available');
    }

    try {
      const token = tokenRef.current;
      const trackId = trackUri.split(':')[2];
      
      // Ensure device is registered and active - transfer if needed
      let transferSuccess = false;
      try {
        transferSuccess = await transferPlayback(true); // Wait for registration
      } catch (transferErr) {
        console.warn('Transfer failed, will try to play anyway:', transferErr);
      }

      // If transfer failed with 404, wait for device registration
      if (!transferSuccess) {
        console.log('Waiting for device registration before playing...');
        const deviceRegistered = await waitForDeviceRegistration(deviceId, 10, 1000);
        if (deviceRegistered) {
          // Try transfer again
          try {
            transferSuccess = await transferPlayback(false); // Don't wait again
          } catch (err) {
            console.warn('Retry transfer failed:', err);
          }
        }
      }

      // Generate queue if needed (async, don't block playback)
      if (!skipQueueGen && trackId) {
        generateQueue({ id: trackId }, 20).then(recommendedTracks => {
          if (recommendedTracks.length > 0) {
            // Add recommended tracks to Spotify's queue
            addToQueue(recommendedTracks);
          }
        }).catch(err => {
          console.warn('Queue generation failed:', err);
        });
      }

      // Play the track - Spotify will handle queue
      const playUrl = `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`;
      let response = await fetch(playUrl, {
        method: 'PUT',
        body: JSON.stringify({
          uris: [trackUri], // Play just this track
          position_ms: positionMs,
        }),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Error playing track:', response.status, errorText);
        
        // If 404, device still not registered - wait and retry
        if (response.status === 404) {
          console.log('Device not found (404), waiting for registration and retrying...');
          
          // Wait for device registration with more attempts
          const deviceRegistered = await waitForDeviceRegistration(deviceId, 15, 1000);
          
          if (deviceRegistered) {
            // Try transfer one more time
            try {
              await transferPlayback(false);
              await new Promise(resolve => setTimeout(resolve, 500));
            } catch (err) {
              console.warn('Final transfer attempt failed:', err);
            }
            
            // Retry play
            response = await fetch(playUrl, {
              method: 'PUT',
              body: JSON.stringify({
                uris: [trackUri],
                position_ms: positionMs,
              }),
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
            });

            if (!response.ok) {
              const retryErrorText = await response.text();
              throw new Error(`Failed to play track after waiting for device: ${response.status} - ${retryErrorText}\n\nPlease ensure:\n1. You have Spotify Premium\n2. The device is properly initialized\n3. Try refreshing the page if the issue persists`);
            }
          } else {
            throw new Error(`Device not registered after waiting. Please ensure you have Spotify Premium and try refreshing the page.`);
          }
        } else {
          throw new Error(`Failed to play track: ${response.status} - ${errorText}`);
        }
      }
      
      console.log('Successfully started playback');
    } catch (err) {
      console.error('Error playing track:', err);
      throw err;
    }
  }, [player, deviceId, transferPlayback, waitForDeviceRegistration, generateQueue, addToQueue]);

  // Play next track from queue - use Spotify's skip next
  const playNextTrack = useCallback(async () => {
    if (!player || !isReady) {
      return;
    }

    try {
      const token = tokenRef.current;
      // Use Spotify's skip to next track API
      const response = await fetch('https://api.spotify.com/v1/me/player/next', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok && response.status !== 204) {
        const errorText = await response.text();
        console.warn('Failed to skip to next track:', response.status, errorText);
      }
    } catch (err) {
      console.error('Error skipping to next track:', err);
    }
  }, [player, isReady]);

  // Play previous track from queue - use Spotify's skip previous
  const playPreviousTrack = useCallback(async () => {
    if (!player || !isReady) {
      return;
    }

    try {
      const token = tokenRef.current;
      // Use Spotify's skip to previous track API
      const response = await fetch('https://api.spotify.com/v1/me/player/previous', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok && response.status !== 204) {
        const errorText = await response.text();
        console.warn('Failed to skip to previous track:', response.status, errorText);
      }
    } catch (err) {
      console.error('Error skipping to previous track:', err);
    }
  }, [player, isReady]);

  // Play a track (with optional queue generation)
  const playTrack = useCallback(async (trackUri, positionMs = 0, generateQueueForTrack = true) => {
    await playTrackInternal(trackUri, positionMs, !generateQueueForTrack);
  }, [playTrackInternal]);

  // Pause playback
  const pause = useCallback(async () => {
    if (!player || !isReady) {
      return;
    }
    await player.pause();
  }, [player, isReady]);

  // Resume playback
  const resume = useCallback(async () => {
    if (!player || !isReady) {
      return;
    }
    await player.resume();
  }, [player, isReady]);

  // Seek to position
  const seek = useCallback(async (positionMs) => {
    if (!player || !isReady) {
      return;
    }
    await player.seek(positionMs);
  }, [player, isReady]);

  // Set volume
  const setPlayerVolume = useCallback(async (newVolume) => {
    if (!player || !isReady) {
      return;
    }
    const volumeValue = Math.max(0, Math.min(100, newVolume));
    setVolume(volumeValue);
    await player.setVolume(volumeValue / 100);
  }, [player, isReady]);

  // Get current playback state
  const getCurrentState = useCallback(async () => {
    if (!player || !isReady) {
      return null;
    }
    return await player.getCurrentState();
  }, [player, isReady]);

  // Sync to position (for guests)
  const syncToPosition = useCallback(async (trackUri, positionMs, isPlaying) => {
    if (!player || !deviceId || !isReady) {
      return;
    }

    try {
      const token = tokenRef.current;
      const currentState = await player.getCurrentState();
      const currentTrackId = currentState?.track_window?.current_track?.id;
      const trackId = trackUri.split(':')[2];

      // If different track, play it
      if (currentTrackId !== trackId) {
        // Ensure playback is transferred to this device
        try {
          await transferPlayback();
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (transferError) {
          console.warn('Transfer playback failed during sync:', transferError);
        }

        const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
          method: 'PUT',
          body: JSON.stringify({
            uris: [trackUri],
            position_ms: positionMs,
          }),
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok && response.status === 404) {
          // Retry with transfer
          await transferPlayback();
          await new Promise(resolve => setTimeout(resolve, 200));
          await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
            method: 'PUT',
            body: JSON.stringify({
              uris: [trackUri],
              position_ms: positionMs,
            }),
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
          });
        }
      } else {
        // Same track, just seek
        const currentPosition = currentState?.position || 0;
        const diff = Math.abs(currentPosition - positionMs);
        
        // Only seek if difference is more than 500ms
        if (diff > 500) {
          await player.seek(positionMs);
        }
      }

      // Sync play/pause state
      if (isPlaying && currentState?.paused) {
        await player.resume();
      } else if (!isPlaying && !currentState?.paused) {
        await player.pause();
      }
    } catch (err) {
      console.error('Error syncing position:', err);
    }
  }, [player, deviceId, isReady, transferPlayback]);

  // Monitor position for autoplay
  // Note: Spotify automatically plays the next track in the queue, so this is mainly
  // for cases where we need to manually advance (e.g., if queue is empty)
  useEffect(() => {
    if (!autoplay || !isPlaying || duration === 0) return;

    // Check if track is near the end (within last 2 seconds)
    if (duration - position < 2000 && duration - position > 0) {
      // Spotify will automatically play the next track if there's one in the queue
      // We only need to manually advance if there's no queue or it's empty
      if (queue.length === 0) {
        // No queue, might need to generate one or just let track end
        // For now, let Spotify handle it - it will just stop if no queue
      }
    }
  }, [position, duration, isPlaying, autoplay, queue]);

  const value = {
    player,
    deviceId,
    isReady,
    isPlaying,
    isPaused,
    isActive,
    currentTrack,
    position,
    duration,
    volume,
    error,
    queue,
    currentQueueIndex,
    autoplay,
    initializePlayer,
    playTrack,
    pause,
    resume,
    seek,
    setVolume: setPlayerVolume,
    getCurrentState,
    syncToPosition,
    generateQueue,
    addToQueue,
    clearQueue,
    removeFromQueue,
    playNextTrack,
    playPreviousTrack,
    setAutoplay,
  };

  return (
    <SpotifyContext.Provider value={value}>
      {children}
    </SpotifyContext.Provider>
  );
};

