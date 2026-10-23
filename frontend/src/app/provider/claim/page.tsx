"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { BusinessDetail } from "@/lib/types";

function ClaimInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { user, loading } = useAuth();
  const businessId = params.get("business");
  const [business, setBusiness] = useState<BusinessDetail | null>(null);
  const [evidence, setEvidence] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (businessId) {
      api<BusinessDetail>(`/api/businesses/${businessId}`).then(setBusiness).catch((e) => setError(e.message));
    }
  }, [businessId]);

  if (loading) return <p className="mx-auto max-w-xl px-4 py-10 text-steel">Loading…</p>;
  if (!user || user.role !== "provider") {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <h1 className="text-2xl font-bold">Claim a business</h1>
        <p className="mt-2 text-steel">You need a repair shop account to claim a listing.</p>
        <Link href={`/register?role=provider`} className="btn mt-4">Create a shop account</Link>
      </div>
    );
  }
  if (!businessId) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <h1 className="text-2xl font-bold">Claim a business</h1>
        <p className="mt-2 text-steel">Find your shop in the directory first, then claim it from its profile page.</p>
        <Link href="/search" className="btn mt-4">Search the directory</Link>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/claims", {
        method: "POST",
        body: { business_id: businessId, evidence, contact_phone: phone || null },
      });
      router.push("/provider");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Claim failed");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-2xl font-bold">Claim this business</h1>
      {business && (
        <div className="mt-3 rounded border border-line bg-panel p-4">
          <p className="font-semibold">{business.name}</p>
          <p className="text-sm text-steel">{business.address_raw}</p>
          {business.phone && <p className="text-sm text-steel">{business.phone}</p>}
        </div>
      )}
      <form onSubmit={submit} className="mt-5 space-y-4">
        <div>
          <label className="text-sm font-medium text-steel" htmlFor="cl-ev">
            How can we verify you represent this business? <span className="text-danger">*</span>
          </label>
          <textarea
            id="cl-ev" required minLength={10} maxLength={5000} className="field mt-1 min-h-28"
            placeholder="e.g. I'm the owner — call the shop number listed and ask for me. I can send our business license or a utility bill."
            value={evidence} onChange={(e) => setEvidence(e.target.value)}
          />
          <p className="mt-1 text-xs text-faint">
            Our team reviews every claim. We typically verify by calling the listed business
            number or requesting documentation.
          </p>
        </div>
        <div>
          <label className="text-sm font-medium text-steel" htmlFor="cl-phone">Best callback number</label>
          <input id="cl-phone" type="tel" className="field mt-1" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        {error && <p className="text-sm font-medium text-danger">{error}</p>}
        <button className="btn" disabled={busy}>{busy ? "Submitting…" : "Submit claim"}</button>
      </form>
    </div>
  );
}

export default function ClaimPage() {
  return <Suspense><ClaimInner /></Suspense>;
}
