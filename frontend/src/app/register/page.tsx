"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { api, setToken } from "@/lib/api";
import { useAuth } from "@/lib/auth";

function RegisterInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { refresh } = useAuth();
  const [role, setRole] = useState(params.get("role") === "provider" ? "provider" : "driver");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/register", {
        method: "POST",
        body: { email, password, full_name: fullName, phone: phone || null, role },
      });
      const res = await api<{ access_token: string }>("/api/auth/login", {
        method: "POST",
        body: { email, password },
      });
      setToken(res.access_token);
      await refresh();
      router.push(role === "provider" ? "/provider" : "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-2xl font-bold">Create an account</h1>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <fieldset>
          <legend className="text-sm font-medium text-steel">I am a…</legend>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {([["driver", "Driver"], ["provider", "Repair shop"], ["fleet_manager", "Fleet manager"]] as const).map(([v, label]) => (
              <label key={v} className={`cursor-pointer rounded border px-2 py-2 text-center text-sm font-medium ${role === v ? "border-pine bg-pine-wash text-pine" : "border-line"}`}>
                <input type="radio" name="role" className="sr-only" checked={role === v} onChange={() => setRole(v)} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label className="text-sm font-medium text-steel" htmlFor="name">
            {role === "provider" ? "Contact name" : "Full name"}
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
