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

export function Header() {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();

  return (
    <header className="border-b border-line bg-panel">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 h-14">
        <Link href="/" className="display text-xl font-bold text-pine">
          YourFleet
        </Link>
        <nav className="flex items-center gap-5 text-[15px] font-medium text-steel">
          <Link href="/search" className={pathname === "/search" ? "text-ink" : "hover:text-ink"}>
            Find repair
          </Link>
          {user && (user.role === "driver" || user.role === "fleet_manager") && (
            <Link href="/fleet" className={pathname.startsWith("/fleet") ? "text-ink" : "hover:text-ink"}>
              Fleet
            </Link>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-[15px]">
          {loading ? null : user ? (
            <>
              <Link
                href={DASHBOARDS[user.role] ?? "/dashboard"}
                className="font-medium text-steel hover:text-ink"
              >
                {user.role === "provider" ? "My shop" : user.role === "admin" ? "Admin" : "My repairs"}
              </Link>
              <span className="hidden sm:inline text-faint">{user.full_name}</span>
              <button onClick={logout} className="btn-quiet !py-1.5">
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="font-medium text-steel hover:text-ink">
                Sign in
              </Link>
              <Link href="/register" className="btn !py-1.5">
                Create account
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
