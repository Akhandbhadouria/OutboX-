import { Mail, Zap, Shield, Clock } from 'lucide-react';
import { authApi } from '../services/api';
import { useSearchParams } from 'react-router-dom';
import { useEffect } from 'react';
import toast from 'react-hot-toast';

export default function LoginPage() {
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const error = searchParams.get('error');
    if (error === 'auth_failed') toast.error('Google sign-in failed. Please try again.');
    if (error === 'session_error') toast.error('Session error. Please try again.');
  }, [searchParams]);

  return (
    <div className="min-h-screen bg-surface-950 flex">
      {/* Left panel — hero */}
      <div className="hidden lg:flex flex-1 flex-col justify-between p-12 bg-gradient-to-br from-primary-950 via-surface-950 to-surface-950 relative overflow-hidden">
        {/* Decorative orbs */}
        <div className="absolute top-20 left-20 w-72 h-72 bg-primary-600/10 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-primary-800/10 rounded-full blur-3xl" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="p-2 bg-primary-600 rounded-xl">
            <Mail className="w-6 h-6 text-white" />
          </div>
          <span className="text-xl font-bold text-white">ReachInbox</span>
        </div>

        <div className="relative z-10 space-y-8">
          <h1 className="text-5xl font-bold text-white leading-tight">
            Schedule emails
            <br />
            <span className="text-primary-400">at scale</span>
          </h1>
          <p className="text-lg text-slate-400 max-w-md leading-relaxed">
            Distributed email scheduling powered by BullMQ and Redis. 
            Rate-limited, fault-tolerant, and production-ready.
          </p>

          <div className="grid grid-cols-1 gap-4 max-w-sm">
            {[
              { icon: Zap, text: 'BullMQ delayed jobs — no cron' },
              { icon: Shield, text: 'Distributed rate limiting via Redis Lua' },
              { icon: Clock, text: 'Survives restarts, recovers automatically' },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3 text-slate-300">
                <div className="p-1.5 bg-primary-600/20 rounded-lg">
                  <Icon className="w-4 h-4 text-primary-400" />
                </div>
                <span className="text-sm">{text}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 text-sm text-slate-600">
          ReachInbox © {new Date().getFullYear()} · Built with Node.js, React, BullMQ
        </div>
      </div>

      {/* Right panel — login form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-8 animate-fade-in">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 justify-center">
            <div className="p-2 bg-primary-600 rounded-xl">
              <Mail className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-bold">ReachInbox</span>
          </div>

          <div className="space-y-2">
            <h2 className="text-3xl font-bold text-white">Welcome back</h2>
            <p className="text-slate-400">Sign in to manage your email campaigns</p>
          </div>

          <a
            href={authApi.googleLoginUrl}
            id="google-login-btn"
            className="flex items-center justify-center gap-3 w-full py-3 px-4 bg-white text-gray-800 rounded-xl font-medium text-sm hover:bg-gray-50 transition-all duration-150 shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98]"
          >
            {/* Google SVG icon */}
            <svg viewBox="0 0 24 24" className="w-5 h-5" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </a>

          <p className="text-center text-xs text-slate-500">
            By signing in, you agree to our{' '}
            <a href="#" className="text-primary-400 hover:underline">Terms of Service</a>{' '}
            and{' '}
            <a href="#" className="text-primary-400 hover:underline">Privacy Policy</a>
          </p>
        </div>
      </div>
    </div>
  );
}
