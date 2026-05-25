import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';


export function Login() {
  const { signIn, loading, error } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const ok = await signIn(email, password);
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
          <p className="text-sm text-slate-500 mt-1">CaratSense Operations Dashboard · v0.2</p>
        </div>

        {/* Form */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                Email address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="sagar@suntek.in"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-400 bg-gray-50"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-400 bg-gray-50"
              />
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
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {/* Dev bypass notice */}
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-xs text-amber-700 font-medium">Development Mode</p>
            <p className="text-xs text-amber-600 mt-0.5">
              Supabase not configured yet. Sign in will use mock L4 admin access.
            </p>
            <button
              onClick={() => navigate('/dashboard')}
              className="mt-2 text-xs font-semibold text-amber-700 underline hover:no-underline"
            >
              → Enter dashboard directly
            </button>
          </div>
        </div>

        {/* Role guide */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          {[
            { role: 'L1', label: 'Factory Operator', color: 'bg-amber-50 border-amber-200 text-amber-700' },
            { role: 'L2', label: 'Unit Head', color: 'bg-amber-50 border-amber-200 text-amber-700' },
            { role: 'L3', label: 'Procurement Head', color: 'bg-green-50 border-green-200 text-green-700' },
            { role: 'L4', label: 'Admin (Sagar)', color: 'bg-red-50 border-red-200 text-red-700' },
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
