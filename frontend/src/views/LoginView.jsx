import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Building2, Eye, EyeOff, TriangleAlert } from "lucide-react";
import { useSession } from "../context/session";

export default function LoginView() {
  const { signIn } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || "/listings";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(
        err?.response?.data?.detail ||
          err.message ||
          "Sign-in failed. Check your credentials.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface login-grid-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-card border border-border rounded-2xl p-8 shadow-[0_0_60px_rgba(0,0,0,0.6)]">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 bg-raised border border-border rounded-xl flex items-center justify-center mb-3">
            <Building2 className="w-8 h-8 text-accent" />
          </div>
          <h1 className="text-xl font-semibold text-ink">Ivy Homes</h1>
          <p className="text-ink-3 text-xs font-data mt-1">
            Pune · Property Intelligence
          </p>
        </div>

        {error && (
          <div className="flex items-start gap-2 bg-[#2A0F0F] border border-[#5A1A1A] rounded-lg p-3 mb-5">
            <TriangleAlert className="w-4 h-4 text-danger shrink-0 mt-0.5" />
            <p className="text-danger text-sm">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium text-ink-2 mb-1.5">
              Email address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              autoComplete="email"
              placeholder="demo1@ivy.homes"
              className="w-full px-3.5 py-2.5 bg-raised border border-border text-ink rounded-lg text-sm placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-0 focus:ring-offset-surface focus:border-accent transition-all"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-2 mb-1.5">
              Password
            </label>
            <div className="relative">
              <input
                type={reveal ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••••"
                className="w-full px-3.5 py-2.5 bg-raised border border-border text-ink rounded-lg text-sm placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-0 focus:ring-offset-surface focus:border-accent transition-all pr-10"
              />
              <button
                type="button"
                onClick={() => setReveal((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink-2"
                aria-label={reveal ? "Hide password" : "Show password"}
              >
                {reveal ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full py-2.5 bg-accent text-surface font-semibold rounded-lg hover:bg-[#D97706] disabled:opacity-60 disabled:cursor-not-allowed transition-colors mt-1"
          >
            {busy ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <div className="mt-6 p-3 bg-raised border border-border rounded-lg">
          <p className="text-xs text-ink-3 font-medium mb-1">Demo accounts</p>
          <p className="text-xs text-ink-2 font-data">
            demo1@ivy.homes / demo2@ivy.homes / demo3@ivy.homes
          </p>
          {/* <p className="text-xs text-ink-3 font-data mt-1">Password: 86ad2ae6e0</p> */}
        </div>
      </div>
    </div>
  );
}
