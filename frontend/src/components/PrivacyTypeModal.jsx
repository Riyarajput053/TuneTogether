import { X, Globe, Lock, Users } from 'lucide-react';

const PrivacyTypeModal = ({ isOpen, onClose, onSelect }) => {
  if (!isOpen) return null;

  const privacyOptions = [
    {
      type: 'public',
      title: 'Public',
      description: 'Anyone can see and request to join your session',
      icon: Globe,
      color: 'bg-blue-500 hover:bg-blue-600'
    },
    {
      type: 'friends',
      title: 'Friends Only',
      description: 'Only your friends can see and request to join',
      icon: Users,
      color: 'bg-green-500 hover:bg-green-600'
    },
    {
      type: 'private',
      title: 'Private',
      description: 'Hidden from everyone. Invite friends manually',
      icon: Lock,
      color: 'bg-purple-500 hover:bg-purple-600'
    }
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-secondary rounded-2xl p-6 max-w-md w-full mx-4">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">Choose Privacy Type</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
        
        <div className="space-y-3">
          {privacyOptions.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.type}
                onClick={() => onSelect(option.type)}
                className={`w-full ${option.color} text-white p-4 rounded-xl transition-all duration-300 hover:scale-105 flex items-start gap-4 text-left`}
              >
                <Icon className="w-6 h-6 flex-shrink-0 mt-1" />
                <div>
                  <h3 className="font-semibold text-lg mb-1">{option.title}</h3>
                  <p className="text-sm opacity-90">{option.description}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default PrivacyTypeModal;

