const BASE = 'http://localhost:5000';

async function request(path) {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json();
}

export const getHealth    = ()               => request('/api/health');
export const getKpiSummary = ()              => request('/api/kpi-summary');
export const getTeams     = ()               => request('/api/teams');
export const getHistory   = (range = '90d') => request(`/api/history?range=${range}`);
export const getAlerts    = ()               => request('/api/alerts');

export const getTasks = (teamId, status) => {
  const params = new URLSearchParams();
  if (teamId != null) params.set('team', teamId);
  if (status)         params.set('status', status);
  const qs = params.toString();
  return request('/api/tasks' + (qs ? '?' + qs : ''));
};
