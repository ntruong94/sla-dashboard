import React from 'react';

// Small icon set — stroke-based
export const Icon = ({ name, size = 16 }) => {
  const p = {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round',
  };
  switch (name) {
    case 'dashboard': return <svg {...p}><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>;
    case 'teams': return <svg {...p}><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-3.5 3.2-5.5 6.5-5.5s6 2 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.5c2 .3 5 1.8 5.5 5"/></svg>;
    case 'tasks': return <svg {...p}><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 10l2 2 5-5"/><path d="M8 16h8"/></svg>;
    case 'chart': return <svg {...p}><path d="M4 19V5"/><path d="M20 19H4"/><path d="M7 15l4-5 3 3 5-6"/></svg>;
    case 'alerts': return <svg {...p}><path d="M18 16v-5a6 6 0 10-12 0v5l-2 2h16z"/><path d="M10 20a2 2 0 004 0"/></svg>;
    case 'settings': return <svg {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 010-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 014 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 010 4h-.1a1.6 1.6 0 00-1.5 1z"/></svg>;
    case 'close': return <svg {...p}><path d="M6 6l12 12M18 6L6 18"/></svg>;
    case 'alert-critical': return <svg {...p}><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.7 3.86a2 2 0 00-3.4 0z"/></svg>;
    case 'alert-warning': return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>;
    case 'arrow-up': return <svg {...p}><path d="M7 14l5-5 5 5"/></svg>;
    case 'arrow-down': return <svg {...p}><path d="M7 10l5 5 5-5"/></svg>;
    case 'tasks-sm': return <svg {...p}><rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M8 9h8M8 12.5h6M8 16h4"/></svg>;
    case 'pct': return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round">
        {/* Solid right arc: 12 o'clock clockwise ~150° to lower-right */}
        <path d="M12 3 A9 9 0 0 1 16.5 19.8" strokeLinecap="round"/>
        {/* Dashed left/bottom arc: lower-right clockwise ~210° back to 12 o'clock */}
        <path d="M16.5 19.8 A9 9 0 1 1 12 3" strokeLinecap="butt" strokeDasharray="3.8 2.8"/>
        {/* % sign */}
        <circle cx="9.5" cy="9.5" r="2" fill="currentColor" stroke="none"/>
        <circle cx="14.5" cy="14.5" r="2" fill="currentColor" stroke="none"/>
        <line x1="16" y1="8" x2="8" y2="16" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    );
    case 'hourglass': return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        {/* Top cap */}
        <rect x="3" y="2" width="18" height="2.5" rx="0.5"/>
        {/* Bottom cap */}
        <rect x="3" y="19.5" width="18" height="2.5" rx="0.5"/>
        {/* Top half: curves from cap inward to waist */}
        <path d="M4 4.5 C4 7.5 10 10.5 12 12 C14 10.5 20 7.5 20 4.5 Z"/>
        {/* Bottom half: curves from waist outward to cap */}
        <path d="M4 19.5 C4 16.5 10 13.5 12 12 C14 13.5 20 16.5 20 19.5 Z"/>
      </svg>
    );
    case 'clock': return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {/* Counterclockwise arc ~270°: 9 o'clock → 12 o'clock (long way round) */}
        <path d="M3 12a9 9 0 1 0 9-9"/>
        {/* Corner arrow at top-left showing rotation direction */}
        <path d="M3 9V3h6"/>
        {/* Clock hands */}
        <path d="M12 8v4l2.5 2"/>
      </svg>
    );
    case 'flame': return <svg {...p}><path d="M12 22c4.5 0 7-3 7-6.5 0-3-2-5-3.5-6-.5 1.5-2 2-2 2s-.5-2-2-4c-1 1-1.5 2.5-1.5 4 0 1.5-1.5 2-1.5 4C8.5 18.5 7.5 22 12 22z"/><path d="M12 17c1.5 0 2.5-1 2.5-2.5 0-1-.5-1.5-1-2-.5.5-.5 1-.5 1s-.5-.5-.5-1.5C12 11 11 12 11 14.5c0 1.5 1 2.5 1 2.5z" fill="currentColor" stroke="none"/></svg>;
    case 'grid': return <svg {...p}><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>;
    case 'user-shield': return <svg {...p}><path d="M12 2l7 3v5c0 4.5-3 8-7 9-4-1-7-4.5-7-9V5l7-3z"/><circle cx="12" cy="10" r="2.5"/><path d="M8.5 17c.5-2 2-3 3.5-3s3 1 3.5 3"/></svg>;
    case 'staff-list': return <svg {...p}><circle cx="7" cy="7.5" r="3"/><path d="M1.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><line x1="15" y1="7" x2="22" y2="7"/><line x1="15" y1="11" x2="22" y2="11"/><line x1="15" y1="15" x2="20" y2="15"/></svg>;
    default: return null;
  }
};

export default Icon;
