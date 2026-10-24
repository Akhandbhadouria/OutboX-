import { Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authApi, slackApi } from '../services/api';
import { Mail, LayoutDashboard, LogOut, Slack, ExternalLink, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import DashboardPage from '../pages/DashboardPage';

export default function DashboardLayout() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const { data: user } = useQuery({ queryKey: ['me'], queryFn: authApi.me });
  const { data: slackStatus } = useQuery({
    queryKey: ['slack-status'],
    queryFn: slackApi.status,
  });

  const logoutMutation = useMutation({
    mutationFn: authApi.logout,
    onSuccess: () => {
      queryClient.clear();
      window.location.href = '/login';
    },
    onError: () => toast.error('Logout failed'),
  });

  const disconnectSlack = useMutation({
    mutationFn: slackApi.disconnect,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['slack-status'] });
      toast.success('Slack disconnected');
    },
  });

  return (
    <div className="min-h-screen bg-surface-950 flex flex-col">
      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-surface-900/80 backdrop-blur-md border-b border-surface-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link to="/dashboard" className="flex items-center gap-2.5">
              <div className="p-1.5 bg-primary-600 rounded-lg">
                <Mail className="w-4 h-4 text-white" />
              </div>
              <span className="font-bold text-white">ReachInbox</span>
            </Link>

            {/* Nav */}
            <nav className="hidden md:flex items-center gap-1">
              <Link
                to="/dashboard"
                className={location.pathname === '/dashboard' ? 'nav-link-active' : 'nav-link'}
              >
                <LayoutDashboard className="w-4 h-4" />
                Dashboard
              </Link>
              <a
                href="/admin/queues"
                target="_blank"
                rel="noopener noreferrer"
                className="nav-link"
              >
                <ExternalLink className="w-4 h-4" />
                Queue Monitor
              </a>
            </nav>

            {/* Right side */}
            <div className="flex items-center gap-3">
              {/* Slack status */}
              {slackStatus?.connected ? (
                <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full text-xs text-emerald-400">
                  <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse-slow" />
                  Slack: {slackStatus.teamName}
                </div>
              ) : (
                <a
                  href={slackApi.connectUrl}
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-[#4A154B]/20 border border-[#4A154B]/40 rounded-full text-xs text-purple-300 hover:bg-[#4A154B]/30 transition-colors"
                >
                  <Slack className="w-3.5 h-3.5" />
                  Connect Slack
                </a>
              )}

              {/* User menu */}
              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-800 transition-colors"
                >
                  {user?.avatarUrl ? (
                    <img
                      src={user.avatarUrl}
                      alt={user.name}
                      className="w-7 h-7 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-primary-600 flex items-center justify-center text-xs font-medium text-white">
                      {user?.name?.[0]?.toUpperCase()}
                    </div>
                  )}
                  <div className="hidden sm:block text-left">
                    <div className="text-xs font-medium text-slate-200">{user?.name}</div>
                    <div className="text-xs text-slate-500">{user?.email}</div>
                  </div>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                </button>

                {userMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 w-56 bg-surface-800 border border-surface-700 rounded-xl shadow-2xl py-1 z-50 animate-fade-in">
                    <div className="px-4 py-2.5 border-b border-surface-700">
                      <div className="text-sm font-medium text-slate-200">{user?.name}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{user?.email}</div>
                    </div>

                    {slackStatus?.connected ? (
                      <button
                        onClick={() => { disconnectSlack.mutate(); setUserMenuOpen(false); }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-300 hover:bg-surface-700 hover:text-slate-100 transition-colors"
                      >
                        <Slack className="w-4 h-4 text-purple-400" />
                        Disconnect Slack
                      </button>
                    ) : (
                      <a
                        href={slackApi.connectUrl}
                        className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-300 hover:bg-surface-700 hover:text-slate-100 transition-colors"
                        onClick={() => setUserMenuOpen(false)}
                      >
                        <Slack className="w-4 h-4 text-purple-400" />
                        Connect Slack
                      </a>
                    )}

                    <button
                      onClick={() => { logoutMutation.mutate(); setUserMenuOpen(false); }}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-400 hover:bg-surface-700 transition-colors"
                      id="logout-btn"
                    >
                      <LogOut className="w-4 h-4" />
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ─── Main content ─────────────────────────────────────────────────── */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Routes>
          <Route index element={<DashboardPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  );
}
