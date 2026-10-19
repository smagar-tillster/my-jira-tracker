import React from 'react';

interface ComingSoonProps {
  icon: string;
  name: string;
  description: string;
}

const ComingSoon: React.FC<ComingSoonProps> = ({ icon, name, description }) => (
  <div className="h-full flex items-center justify-center text-gray-400">
    <div className="text-center">
      <div className="text-5xl mb-4">{icon}</div>
      <p className="text-xl font-medium text-gray-500">{name} — Coming Soon</p>
      <p className="text-sm mt-2">{description}</p>
    </div>
  </div>
);

export default ComingSoon;
