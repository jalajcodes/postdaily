import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, tokenStore } from "../lib/api";
import { Button, ErrorText, LinkedinIcon as Linkedin } from "../components/ui";

export function LoginPage() {
  const navigate = useNavigate();
  const config = useQuery({ queryKey: ["auth-config"], queryFn: api.auth.config });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function devLogin() {
    setBusy(true);
    try {
      const { token } = await api.auth.devLogin();
      tokenStore.set(token);
      navigate("/");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-50 to-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2 text-xl font-semibold">
          <span className="flex size-8 items-center justify-center rounded-lg bg-brand-500 text-white">P</span>
          PostDaily
        </div>
        <h1 className="text-lg font-semibold">Post on LinkedIn every day, in your own voice.</h1>
        <p className="mt-2 text-sm text-slate-500">
          Drop in a thought, get three drafts that sound like you, and let the queue post them on schedule.
        </p>
        <div className="mt-6 space-y-3">
          {config.data?.linkedinEnabled ? (
            <a href={api.auth.linkedinStartUrl()} className="block">
              <Button className="w-full">
                <Linkedin className="size-4" /> Continue with LinkedIn
              </Button>
            </a>
          ) : (
            config.data && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                LinkedIn sign-in isn't configured yet. Add LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET to .env (see
                README).
              </p>
            )
          )}
          {config.data?.devLoginEnabled && (
            <Button variant="secondary" className="w-full" onClick={devLogin} loading={busy}>
              Continue without LinkedIn (local)
            </Button>
          )}
          <ErrorText error={error ?? config.error} />
        </div>
      </div>
    </div>
  );
}

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get("token");
    if (token) {
      tokenStore.set(token);
      navigate("/", { replace: true });
    } else {
      setError(params.get("error") ?? "Sign-in failed");
    }
  }, [navigate]);
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      {error ? (
        <div className="max-w-sm space-y-3 text-center">
          <ErrorText error={error} />
          <Button variant="secondary" onClick={() => navigate("/login")}>
            Back to sign in
          </Button>
        </div>
      ) : (
        <p className="text-sm text-slate-500">Signing you in…</p>
      )}
    </div>
  );
}
