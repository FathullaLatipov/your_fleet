"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useAuth } from "@/lib/auth";

const DASHBOARDS: Record<string, string> = {
  driver: "/dashboard",
  fleet_manager: "/dashboard",
  provider: "/provider",
  admin: "/admin",
};

/* Hex-nut mark in safety orange — the one brand glyph. */
function Mark() {
  return (
    <svg viewBox="0 0 28 28" className="h-7 w-7" aria-hidden>
      <path d="M14 2.5 23.5 8v12L14 25.5 4.5 20V8L14 2.5Z" fill="var(--color-cta)" />
      <path
        d="M14 9.2a4.8 4.8 0 1 0 0 9.6 4.8 4.8 0 0 0 0-9.6Zm0 7.1a2.3 2.3 0 1 1 0-4.6 2.3 2.3 0 0 1 0 4.6Z"
        fill="#16181b"
      />
    </svg>
  );
}

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3.5 py-1.5 text-[15px] font-medium transition-colors ${
        active ? "bg-white/12 text-white" : "text-white/65 hover:bg-white/8 hover:text-white"
      }`}
    >
      {children}
    </Link>
  );
}

export function Header() {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-[1100] border-b border-white/10 bg-charcoal/95 backdrop-blur">
      <div className="mx-auto flex h-15 max-w-6xl items-center gap-5 px-4">
        <Link href="/" className="flex items-center gap-2.5">
          <Mark />
          <span className="display text-xl font-bold tracking-tight text-white">YourFleet</span>
        </Link>
        <nav className="hidden items-center gap-1 sm:flex">
          <NavLink href="/search" active={pathname === "/search"}>Find repair</NavLink>
          {user && (user.role === "driver" || user.role === "fleet_manager") && (
            <NavLink href="/fleet" active={pathname.startsWith("/fleet")}>Fleet</NavLink>
          )}
          {(!user || user.role === "provider") && (
            <NavLink href="/for-shops" active={pathname === "/for-shops"}>For shops</NavLink>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-2.5">
          {loading ? null : user ? (
            <>
              <NavLink
                href={DASHBOARDS[user.role] ?? "/dashboard"}
                active={pathname.startsWith(DASHBOARDS[user.role] ?? "/dashboard")}
              >
                {user.role === "provider" ? "My shop" : user.role === "admin" ? "Admin" : "My repairs"}
              </NavLink>
              <span className="hidden text-sm text-white/45 md:inline">{user.full_name}</span>
              <button
                onClick={logout}
                className="rounded-lg border border-white/20 px-3.5 py-1.5 text-sm font-semibold text-white/85 transition-colors hover:border-white/50 hover:text-white"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-full px-3.5 py-1.5 text-[15px] font-medium text-white/70 transition-colors hover:text-white"
              >
                Sign in
              </Link>
              <Link href="/register" className="btn !py-1.5 !text-sm">
                Create account
              </Link>
            </>
          )}
        </div>
      </div>
      {/* Mobile nav row */}
      <nav className="flex gap-1 overflow-x-auto px-3 pb-2 sm:hidden">
        <NavLink href="/search" active={pathname === "/search"}>Find repair</NavLink>
        {user && (user.role === "driver" || user.role === "fleet_manager") && (
          <NavLink href="/fleet" active={pathname.startsWith("/fleet")}>Fleet</NavLink>
        )}
      </nav>
    </header>
  );
}
