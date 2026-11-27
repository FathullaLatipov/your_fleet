"use client";

import Link from "next/link";
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

interface SamsaraAccount {
  id: string;
  label: string | null;
  status: string;
  token_last4: string | null;
  last_error: string | null;
  last_checked_at: string | null;
  connected_at: string | null;
}

/* Samsara (multi-account): a carrier can connect more than one Samsara org;
   their data merges into the fleet. The second+ are optional. */
function SamsaraAccountsSection() {
  const [accounts, setAccounts] = useState<SamsaraAccount[] | null>(null);
  const [token, setToken] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(""); // "add" | `test:${id}` | `del:${id}`
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    api<SamsaraAccount[]>("/api/integrations/samsara/accounts").then(setAccounts).catch(() => setAccounts([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!token.trim()) return;
    setBusy("add"); setErr(null);
    try {
      await api("/api/integrations/samsara/accounts", {
        method: "POST", body: { token: token.trim(), label: label.trim() || undefined },
      });
      setToken(""); setLabel(""); load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't connect"); }
    finally { setBusy(""); }
  };
  const retest = async (id: string) => {
    setBusy(`test:${id}`); setErr(null);
    try { await api(`/api/integrations/samsara/accounts/${id}/test`, { method: "POST" }); load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Check failed"); }
    finally { setBusy(""); }
  };
  const remove = async (id: string) => {
    setBusy(`del:${id}`);
    try { await api(`/api/integrations/samsara/accounts/${id}`, { method: "DELETE" }); load(); }
    catch { /* ignore */ } finally { setBusy(""); }
  };

  const hasAny = (accounts?.length ?? 0) > 0;
  const topStatus = hasAny
    ? (accounts!.some((a) => a.status === "connected") ? "connected" : "error")
    : "disconnected";

  return (
    <section className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">Samsara</h3>
          <p className="mt-0.5 text-sm text-steel">
            Live GPS, odometer, fuel level and engine fault codes per truck. Connect more than one
            Samsara account — their data merges into your fleet.
          </p>
        </div>
        <StatusBadge status={topStatus} />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {SAMSARA_FEATURES.map(([title, sub]) => (
          <div key={title} className="rounded-lg border border-line bg-mist/40 p-3">
            <p className="text-sm font-semibold">{title}</p>
            <p className="mt-0.5 text-xs text-steel">{sub}</p>
          </div>
        ))}
      </div>

      {accounts === null ? (
        <p className="mt-4 text-sm text-faint">Loading…</p>
      ) : accounts.length > 0 && (
        <div className="mt-4 space-y-2">
          {accounts.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-mist/40 p-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {a.label || "Samsara"}
                  {a.status === "connected"
                    ? <span className="ml-2 rounded-full bg-pine-wash px-2 py-0.5 text-xs font-semibold text-pine">Connected</span>
                    : <span className="ml-2 rounded-full bg-danger-wash px-2 py-0.5 text-xs font-semibold text-danger">Needs attention</span>}
                </p>
                <p className="mt-0.5 text-xs text-steel">
                  Token <span className="font-mono">••••{a.token_last4}</span> · checked {ago(a.last_checked_at)}
                  {a.status !== "connected" && a.last_error ? ` · ${a.last_error}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button onClick={() => retest(a.id)} disabled={busy !== ""} className="btn-quiet !py-1.5 text-sm">
                  {busy === `test:${a.id}` ? "Checking…" : "Re-check"}
                </button>
                <button onClick={() => remove(a.id)} disabled={busy !== ""} className="btn-danger !py-1.5 text-sm">
                  {busy === `del:${a.id}` ? "…" : "Disconnect"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 border-t border-line pt-4">
        <p className="text-sm font-semibold">{hasAny ? "Add another Samsara account" : "Connect Samsara"}</p>
        <p className="mt-0.5 text-sm text-steel">
          Enter a Samsara API token to sync that account into your fleet{hasAny ? " — a second org is optional" : ""}.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input className="field min-w-0 flex-1" placeholder="Paste your Samsara API token" value={token}
                 onChange={(e) => setToken(e.target.value)} type="password" autoComplete="off" />
          <input className="field !w-40" placeholder="Label (optional)" value={label}
                 onChange={(e) => setLabel(e.target.value)} />
          <button onClick={add} disabled={busy !== "" || !token.trim()} className="btn">
            {busy === "add" ? "Connecting…" : "Connect & Sync"}
          </button>
        </div>
        <p className="mt-2 text-xs text-steel">
          Find your API token in Samsara under Settings → API Tokens.{" "}
          <a href="https://developers.samsara.com/docs/authentication" target="_blank"
             rel="noopener noreferrer" className="font-semibold text-cta hover:underline">Learn more</a>
        </p>
      </div>

      {err && <p className="mt-3 text-sm font-medium text-danger">{err}</p>}
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
            <SamsaraAccountsSection />
            {integrations.filter((i) => i.provider !== "samsara").map((i) =>
              <ComingSoonCard key={i.provider} integ={i} />)}
          </div>
        )}

        <TelegramPtiSection />
      </div>
    </div>
  );
}

interface TgStatus {
  configured: boolean;
  bot_username: string | null;
  linked_count: number;
  drivers: { id: string; driver_name: string; telegram_username: string | null; linked_at: string }[];
}
interface LinkCode {
  code: string;
  bot_username: string | null;
  deep_link: string | null;
  expires_at: string | null;
}

/* Driver PTI over the shared YourFleet Telegram bot: drivers connect with a
   code and run their pre-trip inspection in chat; failed items become PTI
   defects on the truck. This card issues the invite codes. */
function TelegramPtiSection() {
  const [status, setStatus] = useState<TgStatus | null>(null);
  const [invite, setInvite] = useState<LinkCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");

  const load = useCallback(() => {
    api<TgStatus>("/api/fleet/telegram/status").then(setStatus).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const genInvite = async () => {
    setBusy(true);
    try {
      setInvite(await api<LinkCode>("/api/fleet/telegram/link-code", { method: "POST", body: {} }));
      load();
    } catch { /* ignore */ } finally { setBusy(false); }
  };
  const copy = (what: string, text: string) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(what); setTimeout(() => setCopied(""), 1500); }).catch(() => {});
  };
  const unlink = async (id: string) => {
    try { await api(`/api/fleet/telegram/links/${id}`, { method: "DELETE" }); load(); } catch { /* ignore */ }
  };

  return (
    <section className="card mt-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">Inspections — Telegram</h3>
          <p className="mt-0.5 text-sm text-steel">
            Drivers run pre-trip and post-trip inspections in Telegram. Failed items show up as defects on the truck.
          </p>
        </div>
        <Link href="/pti" className="shrink-0 text-sm font-semibold text-pine hover:underline">Inspections →</Link>
      </div>

      {status && !status.configured && (
        <p className="mt-3 rounded-lg border border-dashed border-line bg-mist/50 px-4 py-3 text-sm text-steel">
          The YourFleet driver bot isn&apos;t switched on yet. Generate an invite below — it starts working
          the moment the bot is live.
        </p>
      )}
      {status?.bot_username && (
        <p className="mt-3 text-sm text-steel">Bot: <span className="font-semibold">@{status.bot_username}</span></p>
      )}

      <div className="mt-4">
        <button onClick={genInvite} disabled={busy} className="btn !py-2 text-sm">
          {busy ? "Generating…" : "Generate driver invite"}
        </button>
      </div>

      {invite && (
        <div className="mt-3 rounded-lg border border-pine/30 bg-pine-wash/40 p-4">
          <p className="text-sm font-semibold text-pine">Send this to your driver</p>
          {invite.deep_link ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-panel px-2 py-1.5 text-sm">{invite.deep_link}</code>
              <button onClick={() => copy("link", invite.deep_link!)} className="btn-quiet !py-1.5 text-sm">
                {copied === "link" ? "Copied" : "Copy link"}
              </button>
            </div>
          ) : (
            <p className="mt-2 text-sm text-steel">
              Driver opens the bot and sends: <code className="rounded bg-panel px-1.5 py-0.5">/start {invite.code}</code>
            </p>
          )}
          <p className="mt-2 text-xs text-faint">
            Code <span className="font-mono">{invite.code}</span>
            {invite.expires_at && <> · expires {new Date(invite.expires_at).toLocaleDateString()}</>}
          </p>
        </div>
      )}

      {status && status.drivers.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-faint">
            Connected drivers ({status.linked_count})
          </p>
          <ul className="mt-2 space-y-1">
            {status.drivers.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate font-medium">{d.driver_name}
                  {d.telegram_username && <span className="ml-1.5 text-steel">@{d.telegram_username}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-xs text-faint">{new Date(d.linked_at).toLocaleDateString()}</span>
                  <button onClick={() => unlink(d.id)} className="text-xs font-semibold text-steel hover:text-danger">
                    Unlink
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default function ProfilePage() {
  return (
    <AppShell title="Profile">
      <ProfileInner />
    </AppShell>
  );
}
