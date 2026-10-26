import React, { useEffect, useRef, useState } from 'react';

export interface BellItem {
  id: string;
  icon: string;
  text: string;
  detail?: string;
  onClick: () => void;
}

interface NotificationBellProps {
  items?: BellItem[];
}

/** Notification icon for the header. Shows a count badge and a list when something needs attention. */
const NotificationBell: React.FC<NotificationBellProps> = ({ items = [] }) => {
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
        aria-label={items.length ? `Notifications (${items.length})` : 'Notifications'}
        aria-expanded={open}
        title="Notifications"
        className="relative w-9 h-9 rounded-lg bg-blue-500 hover:bg-blue-400 flex items-center justify-center text-lg">
        🔔
        {items.length > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {items.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white text-gray-800 rounded-lg shadow-xl border border-gray-200 z-50">
          <div className="px-4 py-3 border-b border-gray-100 font-semibold text-sm">Notifications</div>
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              <div className="text-3xl mb-2">🔔</div>
              You're all caught up
            </div>
          ) : (
            items.map(item => (
              <button key={item.id} onClick={() => { setOpen(false); item.onClick(); }}
                className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-blue-50 border-b border-gray-100 last:border-b-0">
                <span className="text-xl">{item.icon}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-gray-800">{item.text}</span>
                  {item.detail && <span className="block text-xs text-gray-500">{item.detail}</span>}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
