import { X, Send } from 'lucide-react';

const RequestSessionModal = ({ isOpen, onClose, session, onRequest }) => {
  if (!isOpen || !session) return null;

  const handleRequest = () => {
    onRequest(session.id);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-secondary rounded-2xl p-6 max-w-md w-full mx-4">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">Request to Join</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
        
        <div className="mb-6">
          <h3 className="text-xl font-semibold mb-2">{session.name}</h3>
          <p className="text-gray-400 mb-4">{session.description || 'No description'}</p>
          <div className="text-sm text-gray-400">
            <p>Host: {session.host_username}</p>
            <p>Members: {session.members?.length || 0}</p>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 bg-gray-600 hover:bg-gray-700 text-white px-6 py-3 rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleRequest}
            className="flex-1 bg-primary hover:bg-green-600 text-white px-6 py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            <Send className="w-4 h-4" />
            Send Request
          </button>
        </div>
      </div>
    </div>
  );
};

export default RequestSessionModal;

