import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dashboardApi, emailApi } from '../services/api';
import {
  Mail, Clock, CheckCircle, XCircle, Inbox, PlusCircle, Search,
  TrendingUp, Activity, ChevronLeft, ChevronRight
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import ComposeModal from '../components/ComposeModal';
import type { ScheduledEmailDto, DashboardStats } from '@reachinbox/shared';

type Tab = 'scheduled' | 'sent';

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<Tab>('scheduled');
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
  let searchTimeout: ReturnType<typeof setTimeout>;

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: dashboardApi.stats,
    refetchInterval: 15_000,
  });

  const { data: scheduledData, isLoading: scheduledLoading } = useQuery({
    queryKey: ['emails-scheduled', page],
    queryFn: () => emailApi.scheduled(page),
    enabled: activeTab === 'scheduled' && !debouncedSearch,
  });

  const { data: sentData, isLoading: sentLoading } = useQuery({
    queryKey: ['emails-sent', page],
    queryFn: () => emailApi.sent(page),
    enabled: activeTab === 'sent' && !debouncedSearch,
  });

  const { data: searchData, isLoading: searchLoading } = useQuery({
    queryKey: ['emails-search', debouncedSearch, page],
    queryFn: () => emailApi.search(debouncedSearch, page),
    enabled: !!debouncedSearch,
  });

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(1);
    }, 400);
  };

  const displayData = debouncedSearch ? searchData : activeTab === 'scheduled' ? scheduledData : sentData;
  const isLoading = debouncedSearch ? searchLoading : activeTab === 'scheduled' ? scheduledLoading : sentLoading;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Clock}
          iconColor="text-blue-400"
          iconBg="bg-blue-500/10"
          label="Scheduled"
          value={stats?.totalScheduled}
          loading={statsLoading}
        />
        <StatCard
          icon={CheckCircle}
          iconColor="text-emerald-400"
          iconBg="bg-emerald-500/10"
          label="Sent"
          value={stats?.totalSent}
          loading={statsLoading}
        />
        <StatCard
          icon={XCircle}
          iconColor="text-red-400"
          iconBg="bg-red-500/10"
          label="Failed"
          value={stats?.totalFailed}
          loading={statsLoading}
        />
        <StatCard
          icon={Activity}
          iconColor="text-purple-400"
          iconBg="bg-purple-500/10"
          label="Active Jobs"
          value={stats?.activeJobs}
          sub={stats ? `${stats.pendingJobs} pending` : undefined}
          loading={statsLoading}
        />
      </div>

      <div className="card">
        <div className="card-header flex-col sm:flex-row gap-3">
          <div className="flex items-center gap-1">
            <button
              onClick={() => { setActiveTab('scheduled'); setPage(1); }}
              className={activeTab === 'scheduled' ? 'btn-primary py-1.5 px-3 text-xs' : 'btn-ghost py-1.5 px-3 text-xs'}
            >
              <Clock className="w-3.5 h-3.5" />
              Scheduled
            </button>
            <button
              onClick={() => { setActiveTab('sent'); setPage(1); }}
              className={activeTab === 'sent' ? 'btn-primary py-1.5 px-3 text-xs' : 'btn-ghost py-1.5 px-3 text-xs'}
            >
              <CheckCircle className="w-3.5 h-3.5" />
              Sent / Failed
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input
                type="text"
                placeholder="Search emails…"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="input pl-9 py-1.5 text-xs w-48"
                id="email-search-input"
              />
            </div>

            <button
              onClick={() => setComposeOpen(true)}
              className="btn-primary py-1.5 px-3 text-xs"
              id="compose-btn"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Compose</span>
            </button>
          </div>
        </div>

        <div className="table-wrapper rounded-none border-0">
          <table className="table">
            <thead>
              <tr>
                <th>Recipient</th>
                <th>Subject</th>
                <th className="hidden md:table-cell">Sender</th>
                <th className="hidden sm:table-cell">
                  {activeTab === 'sent' ? 'Sent' : 'Scheduled'}
                </th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 5 }).map((_, j) => (
                      <td key={j}><div className="skeleton h-4 w-full" /></td>
                    ))}
                  </tr>
                ))
              ) : !displayData?.items?.length ? (
                <tr>
                  <td colSpan={5} className="text-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <Inbox className="w-10 h-10 text-slate-600" />
                      <div>
                        <p className="text-slate-400 font-medium">No emails found</p>
                        <p className="text-slate-600 text-xs mt-1">
                          {activeTab === 'scheduled'
                            ? 'Schedule your first campaign using the Compose button'
                            : 'Sent emails will appear here once delivered'}
                        </p>
                      </div>
                      {activeTab === 'scheduled' && (
                        <button onClick={() => setComposeOpen(true)} className="btn-primary text-xs mt-2">
                          <PlusCircle className="w-3.5 h-3.5" />
                          Schedule an email
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                displayData.items.map((email) => (
                  <EmailRow key={email.id} email={email} activeTab={activeTab} />
                ))
              )}
            </tbody>
          </table>
        </div>

        {displayData && displayData.totalPages > 1 && (
          <div className="px-6 py-4 border-t border-surface-800 flex items-center justify-between text-xs text-slate-400">
            <span>
              {(page - 1) * 20 + 1}–{Math.min(page * 20, displayData.total)} of {displayData.total}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn-ghost p-1.5 disabled:opacity-40"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-2">
                {page} / {displayData.totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(displayData.totalPages, p + 1))}
                disabled={page === displayData.totalPages}
                className="btn-ghost p-1.5 disabled:opacity-40"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {composeOpen && <ComposeModal onClose={() => setComposeOpen(false)} />}
    </div>
  );
}

function StatCard({
  icon: Icon,
  iconColor,
  iconBg,
  label,
  value,
  sub,
  loading,
}: {
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  label: string;
  value?: number;
  sub?: string;
  loading: boolean;
}) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${iconBg}`}>
        <Icon className={`w-5 h-5 ${iconColor}`} />
      </div>
      <div>
        <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{label}</p>
        {loading ? (
          <div className="skeleton h-7 w-16 mt-1" />
        ) : (
          <>
            <p className="text-2xl font-bold text-white mt-0.5">{value?.toLocaleString() ?? '—'}</p>
            {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
          </>
        )}
      </div>
    </div>
  );
}

function EmailRow({ email, activeTab }: { email: ScheduledEmailDto; activeTab: Tab }) {
  const statusMap: Record<string, string> = {
    scheduled: 'badge-scheduled',
    processing: 'badge-processing',
    sent: 'badge-sent',
    failed: 'badge-failed',
  };

  const timeValue = activeTab === 'sent'
    ? email.sentAt ?? email.scheduledAt
    : email.scheduledAt;

  return (
    <tr className="group">
      <td className="font-medium text-slate-200 max-w-[180px] truncate">
        {email.recipientEmail}
      </td>
      <td className="max-w-[200px] truncate text-slate-400">
        {email.subject}
        {email.previewUrl && (
          <a
            href={email.previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-2 text-primary-400 hover:underline text-xs opacity-0 group-hover:opacity-100 transition-opacity"
          >
            Preview ↗
          </a>
        )}
      </td>
      <td className="hidden md:table-cell text-slate-500 text-xs">
        <div>{email.senderName}</div>
        <div className="text-slate-600">{email.senderEmail}</div>
      </td>
      <td className="hidden sm:table-cell text-slate-500 text-xs whitespace-nowrap">
        <div>{format(new Date(timeValue), 'MMM d, HH:mm')}</div>
        <div className="text-slate-600">{formatDistanceToNow(new Date(timeValue), { addSuffix: true })}</div>
      </td>
      <td>
        <span className={statusMap[email.status] ?? 'badge bg-slate-500/20 text-slate-400'}>
          {email.status}
        </span>
        {email.status === 'failed' && email.lastError && (
          <div className="text-xs text-red-400 mt-1 max-w-[120px] truncate" title={email.lastError}>
            {email.lastError}
          </div>
        )}
      </td>
    </tr>
  );
}
