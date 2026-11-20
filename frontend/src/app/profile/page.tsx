"use client";

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Loader } from "@/components/Loader";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Integration {
  provider: string;
  label: string;
  description: string;
  status: string; // connected | error | disconnected | unavailable
  available: boolean;
  token_last4: string | null;
  last_error: string | null;
  last_checked_at: string | null;
  connected_at: string | null;
}

const SAMSARA_FEATURES: [string, string][] = [
  ["Location tracking", "Live routes and vehicle positions in real-time."],
  ["Auto sync", "Automatic updates and alerts for your fleet."],
  ["Fuel insights", "Fuel level and consumption insights per vehicle."],
];

function ago(iso: string | null): string {
  if (!iso) return "—";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    connected: ["Connected", "bg-pine-wash text-pine"],
    error: ["Needs attention", "bg-danger-wash text-danger"],
    disconnected: ["Not connected", "bg-mist text-steel"],
    unavailable: ["Coming soon", "bg-mist text-faint"],
  };
  const [label, cls] = map[status] ?? ["—", "bg-mist text-steel"];
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>;
}

/* Samsara is the one live integration: paste a token, we validate it against
   Samsara and sync the fleet with that company's own token. */
function SamsaraCard({ integ, onChange }: { integ: Integration; onChange: (i: Integration) => void }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<"" | "connect" | "test" | "disconnect">("");
  const [err, setErr] = useState<string | null>(null);
  const connected = integ.status === "connected";

  const connect = async () => {
    if (!token.trim()) return;
    setBusy("connect"); setErr(null);
    try {
      const r = await api<Integration>("/api/integrations/samsara", { method: "PUT", body: { token: token.trim() } });
      onChange(r); setToken("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't connect");
    } finally { setBusy(""); }
  };
  const retest = async () => {
    setBusy("test"); setErr(null);
    try { onChange(await api<Integration>("/api/integrations/samsara/test", { method: "POST" })); }
    catch (e) { setErr(e instanceof Error ? e.message : "Check failed"); }
    finally { setBusy(""); }
  };
  const disconnect = async () => {
    setBusy("disconnect"); setErr(null);
    try {
      await api("/api/integrations/samsara", { method: "DELETE" });
      onChange({ ...integ, status: "disconnected", token_last4: null, connected_at: null, last_error: null });
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't disconnect"); }
    finally { setBusy(""); }
  };

  return (
    <section className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">Samsara</h3>
          <p className="mt-0.5 text-sm text-steel">{integ.description}</p>
        </div>
        <StatusBadge status={integ.status} />
      </div>

      {/* Feature bullets, like the connect screen */}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {SAMSARA_FEATURES.map(([title, sub]) => (
          <div key={title} className="rounded-lg border border-line bg-mist/40 p-3">
            <p className="text-sm font-semibold">{title}</p>
            <p className="mt-0.5 text-xs text-steel">{sub}</p>
          </div>
        ))}
      </div>

      {connected ? (
        <div className="mt-4 rounded-lg border border-pine/30 bg-pine-wash/50 p-4">
          <p className="text-sm font-semibold text-pine">Connected and syncing.</p>
          <p className="mt-1 text-sm text-steel">
            Token ending <span className="font-mono">••••{integ.token_last4}</span> ·
            last checked {ago(integ.last_checked_at)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={retest} disabled={busy !== ""} className="btn-quiet !py-1.5 text-sm">
              {busy === "test" ? "Checking…" : "Re-check"}
            </button>
            <button onClick={disconnect} disabled={busy !== ""} className="btn-danger !py-1.5 text-sm">
              {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <p className="text-sm font-semibold">Connect Samsara</p>
          <p className="mt-0.5 text-sm text-steel">
            Enter your Samsara API token to sync your fleet. We&apos;ll pull real-time location,
            fuel level and fuel consumption for each vehicle.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              className="field min-w-0 flex-1"
              placeholder="Paste your Samsara API token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              type="password"
              autoComplete="off"
            />
            <button onClick={connect} disabled={busy !== "" || !token.trim()} className="btn">
              {busy === "connect" ? "Connecting…" : "Connect & Sync"}
            </button>
          </div>
          <p className="mt-2 text-xs text-steel">
            Find your API token in Samsara under Settings → API Tokens.{" "}
            <a href="https://developers.samsara.com/docs/authentication" target="_blank"
               rel="noopener noreferrer" className="font-semibold text-cta hover:underline">Learn more</a>
          </p>
        </div>
      )}

      {(err || (integ.status === "error" && integ.last_error)) && (
        <p className="mt-3 text-sm font-medium text-danger">{err ?? integ.last_error}</p>
      )}
    </section>
  );
}

function ComingSoonCard({ integ }: { integ: Integration }) {
  return (
    <section className="card p-5 opacity-80">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">{integ.label}</h3>
          <p className="mt-0.5 text-sm text-steel">{integ.description}</p>
        </div>
        <StatusBadge status="unavailable" />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input className="field min-w-0 flex-1" placeholder={`${integ.label} API token`} disabled />
        <button className="btn" disabled>Connect</button>
      </div>
      <p className="mt-2 text-xs text-faint">We&apos;re wiring this up — connect it soon from here.</p>
    </section>
  );
}

function ProfileInner() {
  const { user } = useAuth();
  const [integrations, setIntegrations] = useState<Integration[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Integration[]>("/api/integrations")
      .then((d) => { setIntegrations(d); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);
  useEffect(() => { if (user) load(); }, [user, load]);

  const onChange = (updated: Integration) =>
    setIntegrations((cur) => cur?.map((i) => (i.provider === updated.provider ? updated : i)) ?? null);

  if (!user) return <div className="p-10"><Loader /></div>;

  const info: [string, string | null][] = [
    ["Name", user.full_name],
    ["Email", user.email],
    ["Phone", user.phone],
    ["Carrier", user.carrier_name],
    ["MC number", user.mc_number],
    ["DOT number", user.dot_number],
    ["Role", user.role.replace("_", " ")],
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <h2 className="display text-2xl font-bold">Profile</h2>

      {/* Account */}
      <section className="card mt-5 p-5">
        <h3 className="text-lg font-bold">Account</h3>
        <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {info.filter(([, v]) => v).map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs font-semibold uppercase tracking-wide text-faint">{label}</dt>
              <dd className="mt-0.5 text-sm text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Integrations */}
      <div className="mt-6">
        <h3 className="display text-xl font-bold">Integrations</h3>
        <p className="mt-1 text-sm text-steel">
          Connect your own provider accounts. Each token is stored encrypted and used only for your fleet.
        </p>

        {error ? (
          <div className="card mt-4 p-6">
            <p className="font-semibold text-danger">{error}</p>
            <button className="btn-quiet mt-3 !py-2 text-sm" onClick={load}>Try again</button>
          </div>
        ) : integrations === null ? (
          <div className="mt-4"><Loader /></div>
        ) : (
          <div className="mt-4 space-y-4">
            {integrations.map((i) =>
              i.provider === "samsara"
                ? <SamsaraCard key={i.provider} integ={i} onChange={onChange} />
                : <ComingSoonCard key={i.provider} integ={i} />,
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <AppShell title="Profile">
      <ProfileInner />
    </AppShell>
  );
}
