import { useState, useEffect } from 'react';
import { Sparkles, Loader2, Play, Music, TrendingUp, Clock } from 'lucide-react';
import { api } from '../utils/api';

export default function Recommendations({ onTrackSelect }) {
  const [popularSongs, setPopularSongs] = useState([]);
  const [latestSongs, setLatestSongs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRecommendations();
  }, []);

  const loadRecommendations = async () => {
    try {
      setLoading(true);
      const [popularData, latestData] = await Promise.all([
        api.getPopularSongs(20).catch(() => ({ tracks: [] })),
        api.getLatestSongs(20).catch(() => ({ tracks: [] }))
      ]);
      setPopularSongs(popularData.tracks || []);
      setLatestSongs(latestData.tracks || []);
    } catch (error) {
      console.error('Error loading recommendations:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleTrackClick = (track) => {
    if (onTrackSelect) {
      // Use track.uri if available, otherwise construct it
      const trackUri = track.uri || `spotify:track:${track.id}`;
      onTrackSelect({
        id: track.id,
        name: track.name,
        artist: track.artists?.[0]?.name || 'Unknown Artist',
        album: track.album?.name,
        image: track.album?.images?.[0]?.url || track.album?.images?.[1]?.url,
        uri: trackUri,
        duration_ms: track.duration_ms,
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b border-gray-700 flex items-center justify-between">
        <h3 className="text-white font-semibold text-lg flex items-center space-x-2">
          <Sparkles className="w-5 h-5" />
          <span>For You</span>
        </h3>
        <button
          onClick={loadRecommendations}
          className="text-sm text-gray-400 hover:text-white transition-colors"
        >
          Refresh
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Popular Songs */}
        {popularSongs.length > 0 && (
          <div>
            <div className="flex items-center space-x-2 mb-4">
              <TrendingUp className="w-5 h-5 text-green-500" />
              <h3 className="text-white font-semibold text-lg">Popular Right Now</h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {popularSongs.map((track) => (
                <button
                  key={track.id}
                  onClick={() => handleTrackClick(track)}
                  className="group bg-gray-800/50 hover:bg-gray-700/50 rounded-lg p-3 transition-all text-left"
                >
                  <div className="relative mb-3">
                    {track.album?.images?.[1] ? (
                      <img
                        src={track.album.images[1].url}
                        alt={track.album.name}
                        className="w-full aspect-square rounded object-cover"
                      />
                    ) : (
                      <div className="w-full aspect-square rounded bg-gray-700 flex items-center justify-center">
                        <Music className="w-12 h-12 text-gray-500" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded flex items-center justify-center">
                      <Play className="w-8 h-8 text-white" fill="white" />
                    </div>
                  </div>
                  <p className="text-white font-medium text-sm truncate">{track.name}</p>
                  <p className="text-gray-400 text-xs truncate mt-1">
                    {track.artists?.map((a) => a.name).join(', ') || 'Unknown Artist'}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Latest Songs */}
        {latestSongs.length > 0 && (
          <div>
            <div className="flex items-center space-x-2 mb-4">
              <Clock className="w-5 h-5 text-green-500" />
              <h3 className="text-white font-semibold text-lg">Latest Releases</h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {latestSongs.map((track) => (
                <button
                  key={track.id}
                  onClick={() => handleTrackClick(track)}
                  className="group bg-gray-800/50 hover:bg-gray-700/50 rounded-lg p-3 transition-all text-left"
                >
                  <div className="relative mb-3">
                    {track.album?.images?.[1] ? (
                      <img
                        src={track.album.images[1].url}
                        alt={track.album.name}
                        className="w-full aspect-square rounded object-cover"
                      />
                    ) : (
                      <div className="w-full aspect-square rounded bg-gray-700 flex items-center justify-center">
                        <Music className="w-12 h-12 text-gray-500" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded flex items-center justify-center">
                      <Play className="w-8 h-8 text-white" fill="white" />
                    </div>
                  </div>
                  <p className="text-white font-medium text-sm truncate">{track.name}</p>
                  <p className="text-gray-400 text-xs truncate mt-1">
                    {track.artists?.map((a) => a.name).join(', ') || 'Unknown Artist'}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}

        {popularSongs.length === 0 && latestSongs.length === 0 && (
          <p className="text-gray-400 text-sm text-center">No recommendations available</p>
        )}
      </div>
    </div>
  );
}

