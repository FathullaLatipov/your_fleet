"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { api, setToken } from "@/lib/api";
import { useAuth } from "@/lib/auth";

function RegisterInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { refresh } = useAuth();
  // Sign-up is for fleet managers. Repair shops arrive from the "For shops"
  // pages with ?role=provider; there is no on-page role picker.
  const role = params.get("role") === "provider" ? "provider" : "fleet_manager";
  const [fullName, setFullName] = useState("");
  const [carrierName, setCarrierName] = useState("");
  const [dotNumber, setDotNumber] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Verification step: shown when the server mailed a 6-digit code.
  // /register?verify=<email> re-opens it (e.g. from the sign-in page).
  const [verifyFor, setVerifyFor] = useState<string | null>(params.get("verify"));
  const [code, setCode] = useState("");
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  function finish(token: string) {
    setToken(token);
    void refresh().then(() => router.push(role === "provider" ? "/provider" : "/dashboard"));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api<{ email_verified_at: string | null }>("/api/auth/register", {
        method: "POST",
        body: {
          email, password, full_name: fullName, phone: phone || null, role,
          carrier_name: role === "fleet_manager" ? carrierName.trim() || null : null,
          dot_number: role === "fleet_manager" ? dotNumber.trim() || null : null,
        },
      });
      if (created.email_verified_at === null) {
        // A code is on its way to the inbox — switch to the verify step.
        setVerifyFor(email);
        setResendIn(30);
        setBusy(false);
        return;
      }
      const res = await api<{ access_token: string }>("/api/auth/login", {
        method: "POST",
        body: { email, password },
      });
      finish(res.access_token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!verifyFor) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ access_token: string }>("/api/auth/verify-email", {
        method: "POST",
        body: { email: verifyFor, code: code.trim() },
      });
      finish(res.access_token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
      setBusy(false);
    }
  }

  async function resend() {
    if (!verifyFor || resendIn > 0) return;
    setError(null);
    try {
      await api("/api/auth/resend-code", { method: "POST", body: { email: verifyFor } });
      setResendIn(30);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't resend the code");
    }
  }

  if (verifyFor) {
    return (
      <div className="mx-auto max-w-sm px-4 py-16">
        <h1 className="text-2xl font-bold">Check your email</h1>
        <p className="mt-2 text-sm text-steel">
          We sent a 6-digit code to <span className="font-semibold text-ink">{verifyFor}</span>.
          Enter it below to activate your account.
        </p>
        <form onSubmit={verify} className="mt-6 space-y-4">
          <div>
            <label className="text-sm font-medium text-steel" htmlFor="code">Verification code</label>
            <input id="code" required inputMode="numeric" autoComplete="one-time-code"
                   minLength={6} maxLength={6} pattern="\d{6}" placeholder="••••••"
                   className="field mt-1 text-center text-2xl font-bold tracking-[0.5em]"
                   value={code}
                   onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
          </div>
          {error && <p className="text-sm font-medium text-danger">{error}</p>}
          <button className="btn w-full" disabled={busy || code.length !== 6}>
            {busy ? "Checking…" : "Verify & sign in"}
          </button>
        </form>
        <p className="mt-4 text-sm text-steel">
          Didn&apos;t get it? Check spam, or{" "}
          <button onClick={() => void resend()} disabled={resendIn > 0}
                  className="font-medium text-pine hover:underline disabled:cursor-default disabled:text-faint">
            {resendIn > 0 ? `resend in ${resendIn}s` : "resend the code"}
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-2xl font-bold">
        {role === "provider" ? "Create a shop account" : "Create an account"}
      </h1>
      <form onSubmit={submit} className="mt-6 space-y-4">
        {role === "fleet_manager" && (
          <div>
            <label className="text-sm font-medium text-steel" htmlFor="carrier">Carrier name</label>
            <input id="carrier" required className="field mt-1"
                   placeholder="VKL TRUCKING INC"
                   value={carrierName} onChange={(e) => setCarrierName(e.target.value)}
                   autoComplete="organization" />
          </div>
        )}
        {role === "fleet_manager" && (
          <div>
            <label className="text-sm font-medium text-steel" htmlFor="dot">DOT # (optional)</label>
            <input id="dot" className="field mt-1" inputMode="numeric" placeholder="7654321"
                   value={dotNumber} onChange={(e) => setDotNumber(e.target.value)} />
          </div>
        )}
        <div>
          <label className="text-sm font-medium text-steel" htmlFor="name">
            {role === "provider" ? "Contact name" : "Your full name"}
          </label>
          <input id="name" required className="field mt-1" value={fullName}
                 onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
        </div>
        <div>
          <label className="text-sm font-medium text-steel" htmlFor="email">Email</label>
          <input id="email" type="email" required className="field mt-1" value={email}
                 onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </div>
        <div>
          <label className="text-sm font-medium text-steel" htmlFor="phone">Phone (optional)</label>
          <input id="phone" type="tel" className="field mt-1" value={phone}
                 onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
        </div>
        <div>
          <label className="text-sm font-medium text-steel" htmlFor="password">Password (8+ characters)</label>
          <input id="password" type="password" required minLength={8} className="field mt-1" value={password}
                 onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </div>
        {error && <p className="text-sm font-medium text-danger">{error}</p>}
        <button className="btn w-full" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
      </form>
      <p className="mt-4 text-sm text-steel">
        Already registered? <Link href="/login" className="font-medium text-pine hover:underline">Sign in</Link>
      </p>
    </div>
  );
}

export default function RegisterPage() {
  return <Suspense><RegisterInner /></Suspense>;
}
