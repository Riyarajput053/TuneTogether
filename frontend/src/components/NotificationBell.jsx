import { useState, useEffect, useRef } from 'react';
import { Bell, X, Music } from 'lucide-react';
import { api } from '../utils/api';
import { useNavigate } from 'react-router-dom';
import { useSocket } from '../contexts/SocketContext';
import { useAuth } from '../contexts/AuthContext';

const NotificationBell = () => {
  const { user } = useAuth();
  const { connected, joinSession } = useSocket();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    if (user) {
      loadNotifications();
      // Poll for new notifications every 3 seconds
      const interval = setInterval(loadNotifications, 3000);
      return () => clearInterval(interval);
    }
  }, [user]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadNotifications = async () => {
    try {
      const unread = await api.getUnreadNotifications();
      setNotifications(unread);
      setUnreadCount(unread.length);
    } catch (err) {
      console.error('Error loading notifications:', err);
    }
  };

  const handleGoToJam = async (notification) => {
    if (!notification.session_id) return;

    try {
      // Mark notification as read
      await api.markNotificationRead(notification.id);
      
      // Get session details (user is already a member if request was accepted)
      let session;
      try {
        session = await api.getSession(notification.session_id);
      } catch (err) {
        // If getSession fails, try to join (in case they're not a member yet)
        try {
          session = await api.joinSession(notification.session_id);
        } catch (joinErr) {
          // If already a member, getSession should work, so this is a real error
          throw joinErr;
        }
      }
      
      // Navigate to songs page with session data
      navigate('/songs', { state: { sessionId: notification.session_id, session } });
      
      // Join the session via socket
      if (connected) {
        await joinSession(notification.session_id);
      }
      
      // Reload notifications
      await loadNotifications();
      
      // Close dropdown
      setShowDropdown(false);
    } catch (err) {
      console.error('Error joining session:', err);
      alert(err.message || 'Failed to join session');
    }
  };

  const handleMarkAsRead = async (notificationId) => {
    try {
      await api.markNotificationRead(notificationId);
      await loadNotifications();
    } catch (err) {
      console.error('Error marking notification as read:', err);
    }
  };

  const handleDismiss = async (notificationId) => {
    try {
      await api.markNotificationRead(notificationId);
      await loadNotifications();
    } catch (err) {
      console.error('Error dismissing notification:', err);
    }
  };

  if (!user) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="relative p-2 rounded-lg hover:bg-glass transition-colors"
      >
        <Bell className="w-6 h-6" />
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {showDropdown && (
        <div className="absolute right-0 mt-2 w-80 bg-secondary rounded-2xl shadow-2xl z-50 max-h-96 overflow-y-auto">
          <div className="p-4 border-b border-gray-700 flex items-center justify-between">
            <h3 className="font-semibold text-lg">Notifications</h3>
            {notifications.length > 0 && (
              <button
                onClick={async () => {
                  await api.markAllNotificationsRead();
                  await loadNotifications();
                }}
                className="text-sm text-primary hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              <Bell className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>No new notifications</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-700">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  className="p-4 hover:bg-glass transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="font-semibold mb-1">{notification.title}</div>
                      <div className="text-sm text-gray-400 mb-2">{notification.message}</div>
                      {notification.session_id && (
                        <button
                          onClick={() => handleGoToJam(notification)}
                          className="text-sm text-primary hover:underline flex items-center gap-1"
                        >
                          <Music className="w-4 h-4" />
                          Go to Jam
                        </button>
                      )}
                    </div>
                    <button
                      onClick={() => handleDismiss(notification.id)}
                      className="text-gray-400 hover:text-white transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationBell;

