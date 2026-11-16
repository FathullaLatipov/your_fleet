"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { api, setToken } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { User } from "@/lib/types";

function ResetInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { refresh } = useAuth();
  const token = params.get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ access_token: string }>("/api/auth/reset-password", {
        method: "POST",
        body: { token, password },
      });
      // The new password is saved and we're signed in.
      setToken(res.access_token);
      const me = await api<User>("/api/auth/me");
      await refresh();
      router.push(me.role === "provider" ? "/provider" : me.role === "admin" ? "/admin" : "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reset the password");
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="mx-auto max-w-sm px-4 py-16">
        <h1 className="text-2xl font-bold">Reset link missing</h1>
        <p className="mt-2 text-sm text-steel">
          Open the link from the reset email, or request a new one.
        </p>
        <p className="mt-4 text-sm">
          <Link href="/forgot-password" className="font-medium text-pine hover:underline">
            Request a reset link
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-2xl font-bold">Set a new password</h1>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label className="text-sm font-medium text-steel" htmlFor="password">New password (8+ characters)</label>
          <input id="password" type="password" required minLength={8} maxLength={128} className="field mt-1"
                 value={password} onChange={(e) => setPassword(e.target.value)}
                 autoComplete="new-password" />
        </div>
        <div>
          <label className="text-sm font-medium text-steel" htmlFor="confirm">Repeat new password</label>
          <input id="confirm" type="password" required minLength={8} maxLength={128} className="field mt-1"
                 value={confirm} onChange={(e) => setConfirm(e.target.value)}
                 autoComplete="new-password" />
        </div>
        {error && (
          <p className="text-sm font-medium text-danger">
            {error}
            {/invalid or expired/i.test(error) && (
              <>
                {" "}
                <Link href="/forgot-password" className="font-semibold text-pine hover:underline">
                  Get a new link →
                </Link>
              </>
            )}
          </p>
        )}
        <button className="btn w-full" disabled={busy}>{busy ? "Saving…" : "Save password & sign in"}</button>
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return <Suspense><ResetInner /></Suspense>;
}
