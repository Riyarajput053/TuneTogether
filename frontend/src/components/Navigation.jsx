import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Music, User, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const Navigation = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  
  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };
  
  return (
    <nav className="glass-effect rounded-2xl p-4 mb-8">
      <div className="flex items-center justify-between">
        <Link to="/" className="flex items-center space-x-2">
          <Music className="w-8 h-8 text-primary" />
          <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            TuneTogether
          </h1>
        </Link>
        
        <div className="flex space-x-6">
          <Link 
            to="/songs" 
            className={`px-4 py-2 rounded-lg transition-all duration-300 ${
              location.pathname === '/songs' 
                ? 'bg-primary text-white shadow-lg' 
                : 'hover:bg-glass hover:text-primary'
            }`}
          >
            Stream Songs
          </Link>
          <Link 
            to="/movies" 
            className={`px-4 py-2 rounded-lg transition-all duration-300 ${
              location.pathname === '/movies' 
                ? 'bg-primary text-white shadow-lg' 
                : 'hover:bg-glass hover:text-primary'
            }`}
          >
            Stream Movies
          </Link>
          <Link 
            to="/friends" 
            className={`px-4 py-2 rounded-lg transition-all duration-300 ${
              location.pathname === '/friends' 
                ? 'bg-primary text-white shadow-lg' 
                : 'hover:bg-glass hover:text-primary'
            }`}
          >
            Friends
          </Link>
        </div>
        
        <div className="flex items-center space-x-4">
          {user ? (
            <>
              <Link
                to="/profile"
                className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-all duration-300 ${
                  location.pathname === '/profile'
                    ? 'bg-primary text-white shadow-lg'
                    : 'hover:bg-glass hover:text-primary'
                }`}
              >
                <User className="w-5 h-5" />
                <span>Profile</span>
              </Link>
              <button 
                onClick={handleLogout}
                className="flex items-center space-x-2 px-4 py-2 rounded-lg hover:bg-glass transition-colors"
              >
                <LogOut className="w-5 h-5" />
                <span>Logout</span>
              </button>
            </>
          ) : (
            <div className="flex items-center space-x-4">
              <Link
                to="/login"
                className="px-4 py-2 rounded-lg hover:bg-glass transition-colors"
              >
                Login
              </Link>
              <Link
                to="/signup"
                className="px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/80 transition-colors"
              >
                Sign Up
              </Link>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
};

export default Navigation;

