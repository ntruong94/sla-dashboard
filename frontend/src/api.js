const BASE = import.meta.env.VITE_API_BASE || '';

function getToken() { return localStorage.getItem('sla_token') || ''; }

const EXTRA_HEADERS = import.meta.env.VITE_API_BASE?.includes('ngrok') ? { 'ngrok-skip-browser-warning': 'true' } : {};

async function request(path, options = {}) {
  const res = await fetch(BASE + path, {
    ...options,
    headers: { 'Authorization': `Bearer ${getToken()}`, ...EXTRA_HEADERS, ...(options.headers || {}) },
  });
  if (res.status === 401) {
    localStorage.removeItem('sla_token');
    localStorage.removeItem('sla_user');
    window.dispatchEvent(new Event('sla_logout'));
    throw new Error('Session expired — please log in again');
  }
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json();
}

export async function authLogin(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...EXTRA_HEADERS },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Login failed');
  return data; // { token, email, companyName, role }
}

export async function authForgotPassword(email) {
  const res = await fetch(`${BASE}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...EXTRA_HEADERS },
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data; // { token, expiresIn }
}

export async function authResetPassword(token, password) {
  const res = await fetch(`${BASE}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...EXTRA_HEADERS },
    body: JSON.stringify({ token, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Reset failed');
  return data; // { message }
}

export async function authSignup(email, password) {
  const res = await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...EXTRA_HEADERS },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Signup failed');
  return data; // { message }
}

// Build a query string from a targets dict: { 1: 2, 3: 4 } → 't1=2&t3=4'
function buildTargetQS(targets = {}) {
  const pairs = Object.entries(targets).filter(([, v]) => v > 0).map(([k, v]) => `t${k}=${v}`);
  return pairs.length ? '?' + pairs.join('&') : '';
}

export const getHealth    = ()               => request('/api/health');
export const getKpiSummary = (targets = {}) => request(`/api/kpi-summary${buildTargetQS(targets)}`);
export const getTeams     = (targets = {})  => request(`/api/teams${buildTargetQS(targets)}`);
export const getHistory   = (range = '90d', targets = {}) => {
  const tqs = buildTargetQS(targets);
  return request(`/api/history?range=${range}${tqs ? '&' + tqs.slice(1) : ''}`);
};
export const getAlerts    = (targets = {})  => request(`/api/alerts${buildTargetQS(targets)}`);
export const getAlertTasks = (teamId, atRiskPct = 87.5, customTarget = null) => {
  let url = `/api/alert-tasks/${teamId}?atRiskPct=${atRiskPct}`;
  if (customTarget > 0) url += `&customTarget=${customTarget}`;
  return request(url);
};

export const getLoanSummary = ()              => request('/api/loan-summary');
export const getLoanDetail  = (type)          => request(`/api/loan-detail/${type}`);

// ── Admin-only helpers ────────────────────────────────────────────────────────
async function postAction(path) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${getToken()}`, ...EXTRA_HEADERS },
  });
  if (res.status === 401) {
    localStorage.removeItem('sla_token');
    localStorage.removeItem('sla_user');
    window.dispatchEvent(new Event('sla_logout'));
    throw new Error('Session expired — please log in again');
  }
  if (res.status === 403) throw new Error('Admin access required.');
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json();
}

export const getAdminUsers    = ()   => request('/api/admin/users');
export const deleteAdminUser  = (id) => request(`/api/admin/users/${id}`, { method: 'DELETE' });

export const getStaffDepartments  = ()       => request('/api/staff/departments');
export const getStaffAbsentToday  = ()       => request('/api/staff/absent-today');
export const getStaffByDepartment = (deptId) => request(`/api/staff/department/${deptId}`);

export const getTasks = (teamId, status, scope) => {
  const params = new URLSearchParams();
  if (teamId != null) params.set('team', teamId);
  if (status)         params.set('status', status);
  if (scope)          params.set('scope', scope);
  const qs = params.toString();
  return request('/api/tasks' + (qs ? '?' + qs : ''));
};
