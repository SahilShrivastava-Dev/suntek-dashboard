import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';


export function Login() {
  const { t } = useTranslation();
  // The login page must ALWAYS render in English, even when the user picked Hindi
  // inside the authenticated app (the choice persists in localStorage). Resolve
  // every login label against the English resources without mutating the stored
  // preference, so the app still opens in the user's language after sign-in.
  const tf = (key: string, opts?: Record<string, unknown>) => t(key, { lng: 'en', ...opts });
  const { signIn, loading, error, session } = useAuth();
  const navigate = useNavigate();

  // Already signed in → go straight to the dashboard.
  useEffect(() => {
    if (session) navigate('/dashboard', { replace: true });
  }, [session, navigate]);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const ok = await signIn(identifier, password);
    setSubmitting(false);
    if (ok) {
      navigate('/dashboard');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-slate-900 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-sm">
            <span className="text-white text-xl font-extrabold">S°</span>
          </div>
          <h1 className="serif text-[28px] leading-tight">Suntek Group</h1>
          <p className="text-sm text-slate-500 mt-1">{tf('login.subtitle')}</p>
        </div>

        {/* Form */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                {tf('login.identifierLabel')}
              </label>
              <input
                type="text"
                required
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={tf('login.identifierPlaceholder')}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-400 bg-gray-50"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                {tf('login.passwordLabel')}
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 pr-10 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-400 bg-gray-50"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? tf('login.hidePassword') : tf('login.showPassword')}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600 focus:outline-none"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {(error) && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting || loading}
              className="w-full py-2.5 bg-gray-900 text-white text-sm font-semibold rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? tf('login.signingIn') : tf('login.signIn')}
            </button>
          </form>

          {/* Dev bypass — only present in development builds. Production requires
              a real Supabase sign-in (the dashboard auth gate enforces it). */}
          {import.meta.env.DEV && (
            <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-xs text-amber-700 font-medium">{tf('login.devMode')}</p>
              <p className="text-xs text-amber-600 mt-0.5">
                {tf('login.devModeHint')}
              </p>
              <button
                onClick={() => navigate('/dashboard')}
                className="mt-2 text-xs font-semibold text-amber-700 underline hover:no-underline"
              >
                {tf('login.enterDashboard')}
              </button>
            </div>
          )}
        </div>

        {/* Role guide */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          {[
            { role: 'L1', label: tf('login.roleFactoryOperator'), color: 'bg-amber-50 border-amber-200 text-amber-700' },
            { role: 'L2', label: tf('login.roleUnitHead'), color: 'bg-amber-50 border-amber-200 text-amber-700' },
            { role: 'L3', label: tf('login.roleProcurementHead'), color: 'bg-green-50 border-green-200 text-green-700' },
            { role: 'L4', label: tf('login.roleAdmin'), color: 'bg-red-50 border-red-200 text-red-700' },
          ].map(({ role, label, color }) => (
            <div key={role} className={`text-center p-2 rounded-lg border text-xs font-medium ${color}`}>
              <span className="font-bold">{role}</span> · {label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
