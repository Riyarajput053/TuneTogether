import { createContext, useContext, useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import { getAuthToken } from '../utils/api';

const SocketContext = createContext(null);

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:8000';

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
};

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const socketRef = useRef(null);

  useEffect(() => {
    // Initialize socket connection
    const token = getAuthToken();
    if (!token) {
      console.log('No auth token found, skipping socket connection');
      return;
    }

    console.log('Initializing socket connection to:', SOCKET_URL);
    console.log('Using default Socket.IO path');
    console.log('Token present:', token ? 'Yes' : 'No');

    const newSocket = io(SOCKET_URL, {
      path: "/socket.io",
      query: { token: token },
      transports: ["websocket", "polling"],
      withCredentials: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5
    });

    newSocket.on('connect', () => {
      console.log('Socket connected:', newSocket.id);
      setConnected(true);
    });

    newSocket.on('connected', (data) => {
      console.log('Socket authenticated:', data);
    });

    newSocket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
      setConnected(false);
    });

    newSocket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
      console.error('Error details:', {
        message: error.message,
        description: error.description,
        context: error.context,
        type: error.type
      });
      setConnected(false);
    });

    newSocket.on('error', (error) => {
      console.error('Socket error:', error);
    });

    setSocket(newSocket);
    socketRef.current = newSocket;

    return () => {
      if (newSocket) {
        newSocket.disconnect();
      }
    };
  }, []);

  const joinSession = async (sessionId) => {
    if (!socket || !connected) {
      throw new Error('Socket not connected');
    }

    return new Promise((resolve, reject) => {
      socket.emit('join_session', { session_id: sessionId }, (response) => {
        if (response && response.error) {
          reject(new Error(response.error));
        } else {
          setCurrentSessionId(sessionId);
          resolve(response);
        }
      });

      socket.once('joined_session', (data) => {
        resolve(data);
      });

      socket.once('error', (error) => {
        reject(new Error(error.message || 'Failed to join session'));
      });
    });
  };

  const leaveSession = async (sessionId) => {
    if (!socket || !connected) {
      return;
    }

    return new Promise((resolve) => {
      socket.emit('leave_session', { session_id: sessionId }, () => {
        setCurrentSessionId(null);
        resolve();
      });
    });
  };

  const sendMessage = (message) => {
    if (!socket || !connected || !currentSessionId) {
      throw new Error('Socket not connected or no active session');
    }

    socket.emit('chat:message', {
      session_id: currentSessionId,
      message: message
    });
  };

  const updateSession = (updates) => {
    if (!socket || !connected || !currentSessionId) {
      throw new Error('Socket not connected or no active session');
    }

    socket.emit('session_update', {
      session_id: currentSessionId,
      ...updates
    });
  };

  return (
    <SocketContext.Provider
      value={{
        socket,
        connected,
        currentSessionId,
        joinSession,
        leaveSession,
        sendMessage,
        updateSession
      }}
    >
      {children}
    </SocketContext.Provider>
  );
};

