// Converts decimal hours to h:mm (e.g. 1.5 → "1:30")
export const fmtHMS = (hours) => {
  const totalMin = Math.round(Math.abs(hours ?? 0) * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
};
