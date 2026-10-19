import React, { useEffect, useRef, useState } from 'react';

/** Notification icon for the header. The list is a placeholder until notifications are built. */
const NotificationBell: React.FC = () => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Notifications"
        aria-expanded={open}
        title="Notifications"
        className="w-9 h-9 rounded-lg bg-blue-500 hover:bg-blue-400 flex items-center justify-center text-lg">
        🔔
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-72 bg-white text-gray-800 rounded-lg shadow-xl border border-gray-200 z-50">
          <div className="px-4 py-3 border-b border-gray-100 font-semibold text-sm">Notifications</div>
          <div className="px-4 py-8 text-center text-sm text-gray-400">
            <div className="text-3xl mb-2">🔔</div>
            Coming soon
            <p className="text-xs mt-1">Alerts from your apps will show up here.</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
