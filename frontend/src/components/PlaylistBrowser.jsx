import { useState, useEffect } from 'react';
import { Music, Loader2 } from 'lucide-react';
import { api } from '../utils/api';

export default function PlaylistBrowser({ onTrackSelect }) {
  const [playlists, setPlaylists] = useState([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingTracks, setLoadingTracks] = useState(false);

  useEffect(() => {
    loadPlaylists();
  }, []);

  const loadPlaylists = async () => {
    try {
      setLoading(true);
      const data = await api.getSpotifyPlaylists();
      setPlaylists(data.items || []);
    } catch (error) {
      console.error('Error loading playlists:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadPlaylistTracks = async (playlistId) => {
    try {
      setLoadingTracks(true);
      const data = await api.getPlaylistTracks(playlistId);
      const trackItems = data.items
        ?.map((item) => item.track)
        .filter((track) => track && track.id) || [];
      setTracks(trackItems);
    } catch (error) {
      console.error('Error loading playlist tracks:', error);
    } finally {
      setLoadingTracks(false);
    }
  };

  const handlePlaylistClick = (playlist) => {
    setSelectedPlaylist(playlist);
    loadPlaylistTracks(playlist.id);
  };

  const handleTrackClick = (track) => {
    if (onTrackSelect) {
      // Use track.uri if available, otherwise construct it
      const trackUri = track.uri || `spotify:track:${track.id}`;
      onTrackSelect({
        id: track.id,
        name: track.name,
        artist: track.artists[0]?.name || 'Unknown Artist',
        album: track.album?.name,
        image: track.album?.images[0]?.url,
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
    <div className="h-full flex">
      {/* Playlists List */}
      <div className="w-1/3 border-r border-gray-700 overflow-y-auto">
        <div className="p-4 border-b border-gray-700">
          <h3 className="text-white font-semibold text-lg flex items-center space-x-2">
            <Music className="w-5 h-5" />
            <span>Your Playlists</span>
          </h3>
        </div>
        <div className="p-2">
          {playlists.length === 0 ? (
            <p className="text-gray-400 text-sm p-4">No playlists found</p>
          ) : (
            playlists.map((playlist) => (
              <button
                key={playlist.id}
                onClick={() => handlePlaylistClick(playlist)}
                className={`w-full text-left p-3 rounded-lg mb-2 transition-colors ${
                  selectedPlaylist?.id === playlist.id
                    ? 'bg-green-600/20 border border-green-600'
                    : 'hover:bg-gray-700/50'
                }`}
              >
                <div className="flex items-center space-x-3">
                  {playlist.images?.[0] ? (
                    <img
                      src={playlist.images[0].url}
                      alt={playlist.name}
                      className="w-12 h-12 rounded object-cover"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded bg-gray-700 flex items-center justify-center">
                      <Music className="w-6 h-6 text-gray-500" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium truncate">{playlist.name}</p>
                    <p className="text-gray-400 text-xs">
                      {playlist.tracks?.total || 0} tracks
                    </p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Tracks List */}
      <div className="flex-1 overflow-y-auto">
        {selectedPlaylist ? (
          <>
            <div className="p-4 border-b border-gray-700 sticky top-0 bg-gray-900/95 backdrop-blur-sm">
              <h3 className="text-white font-semibold text-lg">{selectedPlaylist.name}</h3>
              <p className="text-gray-400 text-sm mt-1">
                {selectedPlaylist.description || `${tracks.length} tracks`}
              </p>
            </div>
            {loadingTracks ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : (
              <div className="p-2">
                {tracks.length === 0 ? (
                  <p className="text-gray-400 text-sm p-4">No tracks in this playlist</p>
                ) : (
                  tracks.map((track, index) => (
                    <button
                      key={track.id}
                      onClick={() => handleTrackClick(track)}
                      className="w-full text-left p-3 rounded-lg mb-2 hover:bg-gray-700/50 transition-colors flex items-center space-x-3"
                    >
                      <span className="text-gray-500 text-sm w-6">{index + 1}</span>
                      {track.album?.images?.[2] ? (
                        <img
                          src={track.album.images[2].url}
                          alt={track.album.name}
                          className="w-12 h-12 rounded object-cover"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded bg-gray-700 flex items-center justify-center">
                          <Music className="w-6 h-6 text-gray-500" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-medium truncate">{track.name}</p>
                        <p className="text-gray-400 text-sm truncate">
                          {track.artists.map((a) => a.name).join(', ')}
                        </p>
                      </div>
                      <span className="text-gray-500 text-xs">
                        {Math.floor(track.duration_ms / 60000)}:
                        {((track.duration_ms % 60000) / 1000).toFixed(0).padStart(2, '0')}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-400">Select a playlist to view tracks</p>
          </div>
        )}
      </div>
    </div>
  );
}

