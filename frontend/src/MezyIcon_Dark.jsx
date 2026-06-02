import React from 'react';
import mezyIcon from './assets/MezyIcon2.png';

export default function MezyIconDark({
  height = 40,
  width,
  compact = false,
  className,
  style,
}) {
  // Compact (sidebar 44×44): M fills the whole black square
  if (compact) {
    return (
      <svg
        viewBox="0 0 64 64"
        width="100%"
        height="100%"
        className={className}
        style={{ display: 'block', ...style }}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Mortgage Ezy"
      >
        <rect x="0" y="0" width="64" height="64" rx="12" ry="12" fill="#000000" />
        <text
          x="32"
          y="36"
          textAnchor="middle"
          dominantBaseline="central"
          fill="#ffffff"
          fontFamily="Inter, Segoe UI, Arial, sans-serif"
          fontSize="58"
          fontWeight="900"
          letterSpacing="-4"
        >E</text>
      </svg>
    );
  }

  // Non-compact (topbar): original PNG image
  return (
    <img
      src={mezyIcon}
      alt="Mortgage Ezy"
      className={className}
      style={{
        height: height,
        width: width ?? 'auto',
        maxWidth: '100%',
        display: 'block',
        objectFit: 'contain',
        ...style,
      }}
    />
  );
}
