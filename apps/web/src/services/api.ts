import type { UserDto, SenderDto, ScheduledEmailDto, DashboardStats, SlackStatusDto, PaginatedResponse, CampaignDto } from '@reachinbox/shared';

const API_BASE = '/api';

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });

  if (res.status === 401) {
    window.location.href = '/login';
    throw new ApiError(401, 'Unauthorized');
  }

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(res.status, json.error ?? `HTTP ${res.status}`, json);
  }

  return json.data as T;
}

export const authApi = {
  me: () => request<UserDto>('/auth/me'),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  googleLoginUrl: `${API_BASE}/auth/google`,
};

export const emailApi = {
  scheduled: (page = 1, pageSize = 20) =>
    request<PaginatedResponse<ScheduledEmailDto>>(`/emails/scheduled?page=${page}&pageSize=${pageSize}`),

  sent: (page = 1, pageSize = 20) =>
    request<PaginatedResponse<ScheduledEmailDto>>(`/emails/sent?page=${page}&pageSize=${pageSize}`),

  getById: (id: string) => request<ScheduledEmailDto>(`/emails/${id}`),

  search: (q: string, page = 1) =>
    request<PaginatedResponse<ScheduledEmailDto>>(`/emails/search?q=${encodeURIComponent(q)}&page=${page}`),

  schedule: (data: unknown) =>
    request<{ scheduled: number; skipped: number }>('/emails/schedule', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

export const campaignApi = {
  create: (formData: FormData) =>
    fetch(`${API_BASE}/campaigns`, {
      method: 'POST',
      credentials: 'include',
      body: formData, // No Content-Type — let browser set multipart
    }).then(async (res) => {
      const json = await res.json();
      if (!res.ok) throw new ApiError(res.status, json.error ?? `HTTP ${res.status}`);
      return json.data as CampaignDto;
    }),
};

export const senderApi = {
  list: () => request<SenderDto[]>('/senders'),
};

export const dashboardApi = {
  stats: () => request<DashboardStats>('/dashboard/stats'),
};

export const slackApi = {
  status: () => request<SlackStatusDto>('/slack/status'),
  connectUrl: `${API_BASE}/slack/connect`,
  disconnect: () => request<void>('/slack/disconnect', { method: 'POST' }),
};

export { ApiError };
