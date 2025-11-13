import { useState, useEffect } from 'react';
import { Search, Loader2, Play, Music, Grid3x3 } from 'lucide-react';
import { api } from '../utils/api';

// Predefined categories
const CATEGORIES = [
  { name: 'Love', id: 'love', icon: '❤️' },
  { name: 'Hindi', id: 'hindi', icon: '🎵' },
  { name: 'Punjabi', id: 'punjabi', icon: '🎶' },
  { name: 'Pop', id: 'pop', icon: '🎤' },
  { name: 'Rock', id: 'rock', icon: '🎸' },
  { name: 'Hip Hop', id: 'hiphop', icon: '🎧' },
  { name: 'Electronic', id: 'electronic', icon: '⚡' },
  { name: 'Jazz', id: 'jazz', icon: '🎷' },
  { name: 'Country', id: 'country', icon: '🤠' },
  { name: 'R&B', id: 'rnb', icon: '🎹' },
];

export default function Explore({ onTrackSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [categoryTracks, setCategoryTracks] = useState({});
  const [loadingCategories, setLoadingCategories] = useState({});

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;

    try {
      setLoading(true);
      setHasSearched(true);
      const data = await api.searchSpotify(query, 'track', 30);
      setResults(data.tracks?.items || []);
    } catch (error) {
      console.error('Error searching:', error);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const loadCategoryTracks = async (category) => {
    if (categoryTracks[category.id]) {
      // Already loaded
      setSelectedCategory(category);
      return;
    }

    try {
      setLoadingCategories(prev => ({ ...prev, [category.id]: true }));
      const data = await api.getCategoryTracks(category.name, 20).catch(() => ({ tracks: [] }));
      setCategoryTracks(prev => ({ ...prev, [category.id]: data.tracks || [] }));
      setSelectedCategory(category);
    } catch (error) {
      console.error(`Error loading ${category.name} tracks:`, error);
      setCategoryTracks(prev => ({ ...prev, [category.id]: [] }));
    } finally {
      setLoadingCategories(prev => ({ ...prev, [category.id]: false }));
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

  return (
    <div className="h-full flex flex-col">
      {/* Search Bar */}
      <div className="p-4 border-b border-gray-700">
        <form onSubmit={handleSearch} className="flex space-x-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for songs, artists, albums..."
              className="w-full pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-green-500"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              'Search'
            )}
          </button>
        </form>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto">
        {hasSearched ? (
          /* Search Results */
          <div className="p-4">
            {loading ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : results.length === 0 ? (
              <p className="text-gray-400 text-center p-8">No results found</p>
            ) : (
              <div className="space-y-2">
                {results.map((track) => (
                  <button
                    key={track.id}
                    onClick={() => handleTrackClick(track)}
                    className="w-full text-left p-3 rounded-lg hover:bg-gray-700/50 transition-colors flex items-center space-x-3 group"
                  >
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
                        {track.artists.map((a) => a.name).join(', ')} • {track.album?.name}
                      </p>
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <Play className="w-5 h-5 text-gray-400" fill="gray" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Categories Section */
          <div className="p-4">
            {!selectedCategory ? (
              /* Category Grid */
              <div>
                <div className="flex items-center space-x-2 mb-6">
                  <Grid3x3 className="w-5 h-5 text-green-500" />
                  <h3 className="text-white font-semibold text-lg">Browse by Category</h3>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                  {CATEGORIES.map((category) => (
                    <button
                      key={category.id}
                      onClick={() => loadCategoryTracks(category)}
                      className="group bg-gradient-to-br from-gray-800 to-gray-900 hover:from-gray-700 hover:to-gray-800 rounded-lg p-6 transition-all text-center border border-gray-700 hover:border-green-500"
                    >
                      <div className="text-4xl mb-2">{category.icon}</div>
                      <p className="text-white font-medium text-sm">{category.name}</p>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* Category Tracks */
              <div>
                <button
                  onClick={() => setSelectedCategory(null)}
                  className="mb-4 text-gray-400 hover:text-white transition-colors flex items-center space-x-2"
                >
                  <span>←</span>
                  <span>Back to Categories</span>
                </button>
                <div className="flex items-center space-x-2 mb-4">
                  <span className="text-2xl">{selectedCategory.icon}</span>
                  <h3 className="text-white font-semibold text-lg">{selectedCategory.name}</h3>
                </div>
                {loadingCategories[selectedCategory.id] ? (
                  <div className="flex items-center justify-center p-8">
                    <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                  </div>
                ) : categoryTracks[selectedCategory.id]?.length > 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {categoryTracks[selectedCategory.id].map((track) => (
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
                ) : (
                  <p className="text-gray-400 text-center p-8">No tracks found for this category</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

