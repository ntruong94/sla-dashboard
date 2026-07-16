import React from 'react';

// Converts decimal hours to h:mm (e.g. 1.5 → "1:30")
export const fmtHMS = (hours) => {
  const totalMin = Math.round(Math.abs(hours ?? 0) * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
};

// Parse "DD/MM/YYYY HH:MM:SS" to timestamp for date-aware sorting
export const parseDMY = (s) => {
  if (!s) return 0;
  const p = String(s).trim().split(' ');
  const [d, m, y] = (p[0] || '').split('/').map(Number);
  const [hh, mm, ss] = (p[1] || '0:0:0').split(':').map(Number);
  if (!y || !m || !d) return 0;
  return new Date(y, m - 1, d, hh || 0, mm || 0, ss || 0).getTime();
};

// Sort array by a column. getVal(item, col) returns comparable value. Nulls sort to bottom.
export const sortRows = (arr, col, dir, getVal) => {
  if (!col) return arr;
  return [...arr].sort((a, b) => {
    const av = getVal(a, col);
    const bv = getVal(b, col);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = (typeof av === 'string' && typeof bv === 'string')
      ? av.toLowerCase().localeCompare(bv.toLowerCase())
      : (av < bv ? -1 : av > bv ? 1 : 0);
    return dir === 'asc' ? cmp : -cmp;
  });
};

// Hook — tracks { col, dir }. Cycle: null → asc → desc → null (reset).
export const useSortState = () => {
  const [sort, setSort] = React.useState({ col: null, dir: 'asc' });
  const cycleSort = React.useCallback((col) => {
    setSort(prev => {
      if (prev.col !== col) return { col, dir: 'asc' };
      if (prev.dir === 'asc') return { col, dir: 'desc' };
      return { col: null, dir: 'asc' };
    });
  }, []);
  return [sort, cycleSort];
};

// Sortable <th> — merges caller's style after the cursor/userSelect defaults.
// Written with React.createElement to keep utils.js as a plain .js file (no JSX).
export const SortTh = ({ sortKey, sort, onSort, style, children }) => {
  const active = sort.col === sortKey;
  return React.createElement(
    'th',
    {
      style: { cursor: 'pointer', userSelect: 'none', ...style },
      onClick: () => onSort(sortKey),
    },
    children,
    React.createElement(
      'span',
      {
        style: {
          marginLeft: 3,
          fontSize: 8,
          opacity: active ? 1 : 0.25,
          color: active ? 'var(--ink-muted, #888)' : 'inherit',
        },
      },
      active && sort.dir === 'desc' ? '▼' : '▲',
    ),
  );
};
