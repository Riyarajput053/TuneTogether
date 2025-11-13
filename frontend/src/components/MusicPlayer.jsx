import { useState, useEffect, useRef } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Maximize2, List, X } from 'lucide-react';
import { useSpotify } from '../contexts/SpotifyContext';
import { formatTime } from '../utils/formatTime';

export default function MusicPlayer({ track, onTrackEnd, isHost = false, onPositionUpdate }) {
  const {
    isReady,
    isPlaying,
    isPaused,
    currentTrack,
    position,
    duration,
    volume,
    playTrack,
    pause,
    resume,
    seek,
    setVolume,
    error,
    queue,
    currentQueueIndex,
    playNextTrack,
    playPreviousTrack,
    removeFromQueue,
  } = useSpotify();

  const [isDragging, setIsDragging] = useState(false);
  const [localPosition, setLocalPosition] = useState(0);
  const [showQueue, setShowQueue] = useState(false);
  const progressBarRef = useRef(null);

  useEffect(() => {
    if (!isDragging) {
      setLocalPosition(position);
    }
  }, [position, isDragging]);

  useEffect(() => {
    if (track && isReady) {
      const trackUri = `spotify:track:${track.id}`;
      playTrack(trackUri, track.position_ms || 0);
    }
  }, [track, isReady, playTrack]);

  const handlePlayPause = async () => {
    if (isPaused) {
      await resume();
    } else {
      await pause();
    }
  };

  const handleSeek = (e) => {
    const rect = progressBarRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const newPosition = percentage * duration;
    setLocalPosition(newPosition);
    setIsDragging(true);
  };

  const handleSeekEnd = async () => {
    setIsDragging(false);
    if (duration > 0) {
      await seek(localPosition);
      if (onPositionUpdate && isHost) {
        onPositionUpdate(Math.floor(localPosition));
      }
    }
  };

  const handleVolumeChange = (e) => {
    const newVolume = parseInt(e.target.value);
    setVolume(newVolume);
  };

  const formatDuration = (ms) => {
    if (!ms) return '0:00';
    return formatTime(ms);
  };

  const progressPercentage = duration > 0 ? (localPosition / duration) * 100 : 0;

  if (error) {
    return (
      <div className="bg-red-900/30 border border-red-600 rounded-lg p-4 text-red-300">
        <p>Error: {error}</p>
      </div>
    );
  }

  if (!isReady) {
    return (
      <div className="bg-gray-800/50 rounded-lg p-8 text-center">
        <p className="text-gray-400">Initializing Spotify player...</p>
      </div>
    );
  }

  const displayTrack = currentTrack || track;

  return (
    <div className="bg-gradient-to-br from-gray-800/90 to-gray-900/90 backdrop-blur-sm rounded-2xl p-6 border border-gray-700 shadow-2xl">
      {displayTrack && (
        <>
          <div className="flex items-center space-x-4 mb-6">
            {displayTrack.image && (
              <img
                src={displayTrack.image}
                alt={displayTrack.album || displayTrack.name}
                className="w-20 h-20 rounded-lg object-cover shadow-lg"
              />
            )}
            <div className="flex-1 min-w-0">
              <h3 className="text-white font-semibold text-lg truncate">{displayTrack.name}</h3>
              <p className="text-gray-400 text-sm truncate">
                {displayTrack.artist || 'Unknown Artist'}
              </p>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="mb-4">
            <div
              ref={progressBarRef}
              className="w-full h-2 bg-gray-700 rounded-full cursor-pointer relative"
              onMouseDown={handleSeek}
              onMouseMove={(e) => {
                if (isDragging) {
                  const rect = progressBarRef.current.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const percentage = Math.max(0, Math.min(1, x / rect.width));
                  setLocalPosition(percentage * duration);
                }
              }}
              onMouseUp={handleSeekEnd}
              onMouseLeave={handleSeekEnd}
            >
              <div
                className="h-full bg-green-500 rounded-full transition-all"
                style={{ width: `${progressPercentage}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>{formatDuration(localPosition)}</span>
              <span>{formatDuration(duration)}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-center space-x-4 mb-4">
            <button
              className={`p-2 rounded-full transition-colors ${
                queue.length > 0 && currentQueueIndex > 0
                  ? 'hover:bg-gray-700 text-white cursor-pointer'
                  : 'text-gray-400 cursor-not-allowed'
              }`}
              onClick={playPreviousTrack}
              disabled={queue.length === 0 || currentQueueIndex <= 0}
            >
              <SkipBack className="w-5 h-5" />
            </button>
            <button
              className="p-4 rounded-full bg-green-600 hover:bg-green-700 transition-colors shadow-lg"
              onClick={handlePlayPause}
            >
              {isPaused ? (
                <Play className="w-6 h-6 text-white" fill="white" />
              ) : (
                <Pause className="w-6 h-6 text-white" fill="white" />
              )}
            </button>
            <button
              className={`p-2 rounded-full transition-colors ${
                queue.length > 0 && currentQueueIndex < queue.length - 1
                  ? 'hover:bg-gray-700 text-white cursor-pointer'
                  : 'text-gray-400 cursor-not-allowed'
              }`}
              onClick={playNextTrack}
              disabled={queue.length === 0 || currentQueueIndex >= queue.length - 1}
            >
              <SkipForward className="w-5 h-5" />
            </button>
          </div>

          {/* Volume Control and Queue Button */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 flex-1">
              <button
                className="p-2 rounded-full hover:bg-gray-700 transition-colors"
                onClick={() => setVolume(volume === 0 ? 50 : 0)}
              >
                {volume === 0 ? (
                  <VolumeX className="w-5 h-5 text-gray-400" />
                ) : (
                  <Volume2 className="w-5 h-5 text-gray-400" />
                )}
              </button>
              <input
                type="range"
                min="0"
                max="100"
                value={volume}
                onChange={handleVolumeChange}
                className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-xs text-gray-400 w-10">{volume}%</span>
            </div>
            <button
              className={`relative p-2 rounded-full transition-colors ml-4 ${
                queue.length > 0
                  ? 'hover:bg-gray-700 text-white'
                  : 'text-gray-500 cursor-not-allowed'
              }`}
              onClick={() => setShowQueue(!showQueue)}
              disabled={queue.length === 0}
              title="Queue"
            >
              <List className="w-5 h-5" />
              {queue.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-green-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-semibold">
                  {queue.length}
                </span>
              )}
            </button>
          </div>

          {/* Queue Display */}
          {showQueue && queue.length > 0 && (
            <div className="mt-4 border-t border-gray-700 pt-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-white font-semibold text-sm">Queue ({queue.length})</h4>
                <button
                  onClick={() => setShowQueue(false)}
                  className="p-1 rounded-full hover:bg-gray-700 transition-colors"
                >
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              </div>
              <div className="max-h-64 overflow-y-auto space-y-2">
                {queue.map((track, index) => (
                  <div
                    key={track.id || index}
                    className={`flex items-center space-x-3 p-2 rounded-lg cursor-pointer transition-colors ${
                      index === currentQueueIndex
                        ? 'bg-green-600/20 border border-green-600'
                        : 'hover:bg-gray-700/50'
                    }`}
                    onClick={async () => {
                      const trackUri = track.uri || `spotify:track:${track.id}`;
                      // playTrackInternal will update currentQueueIndex automatically
                      await playTrack(trackUri, 0, false);
                    }}
                  >
                    {track.image && (
                      <img
                        src={track.image}
                        alt={track.name}
                        className="w-10 h-10 rounded object-cover"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm truncate ${
                        index === currentQueueIndex ? 'text-green-400 font-semibold' : 'text-white'
                      }`}>
                        {track.name}
                      </p>
                      <p className="text-xs text-gray-400 truncate">
                        {track.artist || 'Unknown Artist'}
                      </p>
                    </div>
                    {track.duration_ms && (
                      <span className="text-xs text-gray-400">
                        {formatTime(track.duration_ms)}
                      </span>
                    )}
                    {index !== currentQueueIndex && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFromQueue(index);
                        }}
                        className="p-1 rounded-full hover:bg-gray-600 transition-colors"
                        title="Remove from queue"
                      >
                        <X className="w-3 h-3 text-gray-400" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {!displayTrack && (
        <div className="text-center py-8">
          <p className="text-gray-400">No track selected</p>
        </div>
      )}
    </div>
  );
}

