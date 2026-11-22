import { createClient } from '@supabase/supabase-js';

export const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3000').replace(/\/$/, '');
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

export interface AdminAuth {
  bearerToken?: string;
  adminSecret?: string;
  email?: string;
}

export interface VisualHuffmanTreeNode {
  id: string;
  symbol: string | null;
  bit: '0' | '1' | null;
  code: string;
  depth: number;
  frequency: number;
  left: VisualHuffmanTreeNode | null;
  right: VisualHuffmanTreeNode | null;
}

async function adminFetch<T>(path: string, auth: AdminAuth, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {})
  };
  if (auth.bearerToken) headers['Authorization'] = `Bearer ${auth.bearerToken}`;
  if (auth.adminSecret) headers['x-admin-secret'] = auth.adminSecret;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const AdminApi = {
  getOverview: (auth: AdminAuth) => adminFetch<any>('/api/admin/overview', auth),
  getRooms: (auth: AdminAuth, limit = 50) => adminFetch<{ rooms: any[] }>(`/api/admin/rooms?limit=${limit}`, auth),
  inspectRoom: (auth: AdminAuth, roomId: string) =>
    adminFetch<any>(`/api/admin/rooms/${encodeURIComponent(roomId)}/inspect`, auth),
  getReports: (auth: AdminAuth) => adminFetch<{ reports: any[] }>('/api/admin/reports', auth),
  resolveReport: (auth: AdminAuth, reportId: string, resolved: boolean) =>
    adminFetch<any>(`/api/admin/reports/${encodeURIComponent(reportId)}`, auth, {
      method: 'PATCH',
      body: JSON.stringify({ resolved })
    }),
  getUsers: (auth: AdminAuth) => adminFetch<{ users: any[] }>('/api/admin/users', auth),
  getUserProfile: (auth: AdminAuth, userId: string) =>
    adminFetch<any>(`/api/admin/users/${encodeURIComponent(userId)}/profile`, auth),
  setUserBan: (auth: AdminAuth, userId: string, banned: boolean) =>
    adminFetch<any>(`/api/admin/users/${encodeURIComponent(userId)}/ban`, auth, {
      method: 'POST',
      body: JSON.stringify({ banned })
    }),
  rewardUser: (auth: AdminAuth, userId: string, amount: number, reason: string) =>
    adminFetch<any>(`/api/admin/users/${encodeURIComponent(userId)}/reward`, auth, {
      method: 'POST',
      body: JSON.stringify({ amount, reason })
    }),
  getContent: (auth: AdminAuth) => adminFetch<any>('/api/admin/content', auth),
  updateTopic: (auth: AdminAuth, topic: string) =>
    adminFetch<any>('/api/admin/topic', auth, {
      method: 'PUT',
      body: JSON.stringify({ topic })
    }),
  createCampaign: (
    auth: AdminAuth,
    payload: {
      title: string;
      description: string;
      metric_type: 'streak_days' | 'total_chats' | 'referrals';
      target_value: number;
      reward_stones: number;
      icon_emoji: string;
    }
  ) =>
    adminFetch<any>('/api/admin/campaigns', auth, {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  toggleCampaign: (auth: AdminAuth, campaignId: string, isActive: boolean) =>
    adminFetch<any>(`/api/admin/campaigns/${encodeURIComponent(campaignId)}`, auth, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: isActive })
    }),
  deleteCampaign: (auth: AdminAuth, campaignId: string) =>
    adminFetch<any>(`/api/admin/campaigns/${encodeURIComponent(campaignId)}`, auth, {
      method: 'DELETE'
    }),
  getAlgorithmWorkflows: (auth: AdminAuth, stones: number, target: number, sample: string) =>
    adminFetch<any>(
      `/api/admin/algorithms/workflows?stones=${stones}&target=${target}&sample=${encodeURIComponent(sample)}`,
      auth
    ),
  getGrowth: (auth: AdminAuth, days = 14) =>
    adminFetch<any>(`/api/admin/growth?days=${days}`, auth),
  getSystemHealth: (auth: AdminAuth) => adminFetch<any>('/api/admin/system-health', auth),
  muteUser: (auth: AdminAuth, userId: string, hours: number) =>
    adminFetch<any>(`/api/admin/users/${encodeURIComponent(userId)}/mute`, auth, {
      method: 'POST',
      body: JSON.stringify({ hours })
    }),
  getAuditLogs: (auth: AdminAuth, limit = 50) =>
    adminFetch<{ logs: any[] }>(`/api/admin/audit-logs?limit=${limit}`, auth)
};
