"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { api } from "@/lib/api";

function ForgotInner() {
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/forgot-password", { method: "POST", body: { email } });
      setSentTo(email);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the reset link");
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <div className="mx-auto max-w-sm px-4 py-16">
        <h1 className="text-2xl font-bold">Check your email</h1>
        <p className="mt-2 text-sm text-steel">
          If an account exists for <span className="font-semibold text-ink">{sentTo}</span>,
          we sent a link to reset its password. The link works once and expires in 30 minutes.
        </p>
        <p className="mt-4 text-sm text-steel">
          Didn&apos;t get it? Check spam, or{" "}
          <button onClick={() => setSentTo(null)} className="font-medium text-pine hover:underline">
            try again
          </button>
          .
        </p>
        <p className="mt-4 text-sm text-steel">
          <Link href="/login" className="font-medium text-pine hover:underline">Back to sign in</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-2xl font-bold">Reset your password</h1>
      <p className="mt-2 text-sm text-steel">
        Enter the email you signed up with and we&apos;ll send you a link to set a new password.
      </p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label className="text-sm font-medium text-steel" htmlFor="email">Email</label>
          <input id="email" type="email" required className="field mt-1" value={email}
                 onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </div>
        {error && <p className="text-sm font-medium text-danger">{error}</p>}
        <button className="btn w-full" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button>
      </form>
      <p className="mt-4 text-sm text-steel">
        Remembered it? <Link href="/login" className="font-medium text-pine hover:underline">Sign in</Link>
      </p>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return <Suspense><ForgotInner /></Suspense>;
}
