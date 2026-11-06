"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { Loader } from "@/components/Loader";
import { useAuth } from "@/lib/auth";

/* Hex-nut mark in safety orange — same glyph as the global Header. */
function Mark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden>
      <path d="M14 2.5 23.5 8v12L14 25.5 4.5 20V8L14 2.5Z" fill="var(--color-cta)" />
      <path
        d="M14 9.2a4.8 4.8 0 1 0 0 9.6 4.8 4.8 0 0 0 0-9.6Zm0 7.1a2.3 2.3 0 1 1 0-4.6 2.3 2.3 0 0 1 0 4.6Z"
        fill="#16181b"
      />
    </svg>
  );
}

/* Full-screen branded gate shown instead of the shell (sign-in / wrong role). */
function Gate({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-charcoal bg-[radial-gradient(70rem_40rem_at_50%_-20%,#17523566,transparent)] px-4 py-10">
      <div className="card hero-rise w-full max-w-md p-8 text-center shadow-(--shadow-pop)">
        {children}
      </div>
    </div>
  );
}

/* 24px stroke glyphs — paths shared with the dashboard icon set. */
const ICONS: Record<string, React.ReactNode> = {
  gauge: (
    <path d="M4 4.5h6.5V11H4V4.5ZM13.5 4.5H20V11h-6.5V4.5ZM4 13h6.5v6.5H4V13ZM13.5 13H20v6.5h-6.5V13Z" />
  ),
  truck: (
    <>
      <path d="M2 16V7h11v9M13 10h5l3 3v3h-3M2 16h2m3.5 0H13m4.5 0H21" />
      <path d="M6 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm9 2a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
    </>
  ),
  wrench: (
    <path d="M14.5 6.5a4 4 0 0 1 5-3.9l-2.8 2.8 2 2 2.8-2.8a4 4 0 0 1-5.2 4.9L8 17.8A2.1 2.1 0 1 1 5 14.9l7.6-7.6a4 4 0 0 1 1.9-.8Z" />
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16.5 4.5 4.5" strokeLinecap="round" />
    </>
  ),
  shop: (
    <path d="M4.5 9.5 6 4h12l1.5 5.5M4.5 9.5V20h15V9.5M4.5 9.5h15M9.5 20v-5.5h5V20" />
  ),
  bell: (
    <>
      <path d="M12 3a6 6 0 0 0-6 6v3.2l-1.7 3.3a.6.6 0 0 0 .5.9h14.4a.6.6 0 0 0 .5-.9L18 12.2V9a6 6 0 0 0-6-6Z" />
      <path d="M9.8 19.5a2.3 2.3 0 0 0 4.4 0" strokeLinecap="round" />
    </>
  ),
  trailer: (
    <>
      <path d="M3 6h15v9H3V6ZM18 10h3v5h-3M3 15v3M21 15v3" />
      <path d="M8 19.5a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Zm5 0a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Z" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M3.5 19.5c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5M15.5 5.6a3.5 3.5 0 0 1 0 5.8M17.5 14.7c1.6.7 2.7 2.2 3 4.8" strokeLinecap="round" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3.5 21.5 20h-19L12 3.5Z" strokeLinejoin="round" />
      <path d="M12 10v4.5M12 17.2v.3" strokeLinecap="round" />
    </>
  ),
  check: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="m8.5 12.5 2.5 2.5 4.8-5.3" strokeLinecap="round" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" strokeLinecap="round" />
    </>
  ),
  chat: (
    <path d="M4 5.5h16v10.5h-9l-4.5 3.5v-3.5H4V5.5Z" strokeLinejoin="round" />
  ),
  records: (
    <>
      <path d="M6 3.5h9l3.5 3.5v13.5H6V3.5Z" strokeLinejoin="round" />
      <path d="M15 3.5V7h3.5M9 11h6M9 14.5h6" strokeLinecap="round" />
    </>
  ),
  dollar: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M15 9.3c-.6-1-1.7-1.5-3-1.5-1.7 0-2.9.9-2.9 2.1 0 2.9 6 1.5 6 4.3 0 1.3-1.3 2.2-3.1 2.2-1.4 0-2.6-.6-3.2-1.6M12 6.2v11.6" strokeLinecap="round" />
    </>
  ),
  chart: (
    <path d="M4 20V10M10 20V4M16 20v-8M21 20H3" strokeLinecap="round" />
  ),
  clipboard: (
    <>
      <rect x="5" y="4.5" width="14" height="16" rx="2" />
      <path d="M9 4.5V3h6v1.5M8.5 10h7M8.5 13.5h7M8.5 17h4.5" />
    </>
  ),
  bank: (
    <path d="M3 21h18M5 21V10M19 21V10M9 21V10M15 21V10M2 10l10-7 10 7H2Z" strokeLinejoin="round" />
  ),
  report: (
    <>
      <path d="M6 3.5h9l3.5 3.5v13.5H6V3.5Z" strokeLinejoin="round" />
      <path d="M9 17v-3.5M12 17v-6M15 17v-4.5" strokeLinecap="round" />
    </>
  ),
  bot: (
    <>
      <rect x="4.5" y="8" width="15" height="11" rx="2.5" />
      <path d="M12 8V4.5M9.5 4.5h5M8.5 15h7" strokeLinecap="round" />
      <path d="M9.3 11.8h.01M14.7 11.8h.01" strokeLinecap="round" strokeWidth="2.4" />
    </>
  ),
  fuel: (
    <>
      <path d="M4.5 21V5.5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2V21M3 21h12" />
      <path d="M7 6.5h4.5V11H7zM13.5 10h2l2.5 2.5V19a1.6 1.6 0 0 1-3.2 0v-4h-1.3" />
    </>
  ),
  toll: (
    <>
      <path d="M7.5 3.5 4 20.5M16.5 3.5 20 20.5" strokeLinecap="round" />
      <path d="M12 4v3.2M12 10.4v3.2M12 16.8V20" strokeLinecap="round" />
    </>
  ),
  map: (
    <>
      <path d="M12 21s-6.5-5.3-6.5-10.3a6.5 6.5 0 0 1 13 0C18.5 15.7 12 21 12 21Z" />
      <circle cx="12" cy="10.5" r="2.3" />
    </>
  ),
};

function NavIcon({ name, className = "h-4.5 w-4.5 shrink-0" }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor"
         strokeWidth="1.7" strokeLinejoin="round" aria-hidden>
      {ICONS[name]}
    </svg>
  );
}

interface NavItem {
  href: string;
  label: string;
  icon: string;
  soon?: boolean;
  children?: NavItem[];
}

function isActive(href: string, pathname: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  if (href === "/fleet") return pathname.startsWith("/fleet");
  if (href === "/repairs") return pathname.startsWith("/repairs") || pathname.startsWith("/bookings");
  if (href === "/work-orders") {
    // Manual console: everything under /work-orders except the channel pages.
    return pathname.startsWith("/work-orders")
      && !pathname.startsWith("/work-orders/mobile")
      && !pathname.startsWith("/work-orders/telegram");
  }
  return pathname === href;
}

function SideLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(item.href, pathname);
  return (
    <Link
      href={item.href}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5 hover:text-white"
      }`}
    >
      <NavIcon name={item.icon} />
      {item.label}
      {item.soon && (
        <span className="ml-auto rounded border border-cta/50 px-1.5 text-[10px] font-bold uppercase tracking-wide text-cta">
          Soon
        </span>
      )}
    </Link>
  );
}

function NavDropdown({ item, pathname }: { item: NavItem; pathname: string }) {
  const anyActive = pathname.startsWith(item.href);
  const [open, setOpen] = useState(anyActive);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          anyActive ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5 hover:text-white"
        }`}
      >
        <NavIcon name={item.icon} />
        {item.label}
        <svg viewBox="0 0 24 24" className={`ml-auto h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`}
             fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
          <path d="m9 6 6 6-6 6" />
        </svg>
      </button>
      {open && (
        <div className="mt-0.5 space-y-0.5 border-l border-white/10 pl-3" style={{ marginLeft: 22 }}>
          {item.children!.map((c) => {
            const active = isActive(c.href, pathname);
            return (
              <Link key={c.href} href={c.href}
                    className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                      active ? "bg-white/10 text-white" : "text-white/55 hover:bg-white/5 hover:text-white"
                    }`}>
                {c.label}
                {c.soon && (
                  <span className="ml-auto rounded border border-cta/50 px-1.5 text-[10px] font-bold uppercase tracking-wide text-cta">
                    Soon
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AppShell({ title, children }: { title: string; children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  function signOut() {
    logout();
    router.push("/");
  }

  if (loading) return <Loader className="min-h-screen" />;
  if (!user) {
    return (
      <Gate>
        <Mark className="mx-auto h-12 w-12" />
        <h1 className="mt-4 text-2xl font-bold">Sign in to YourFleet</h1>
        <p className="mt-2 text-[15px] text-steel">
          Your fleet lives behind your account — trucks, maintenance schedules,
          PTI defects, repairs and every dollar spent.
        </p>
        <Link href={`/login?next=${encodeURIComponent(pathname)}`} className="btn mt-6 w-full !py-3">
          Sign in
        </Link>
        <Link href="/register" className="btn-quiet mt-2.5 w-full">
          Create a free account
        </Link>
        <Link href="/" className="mt-5 inline-block text-sm font-medium text-steel hover:text-ink hover:underline">
          ← Back to the site
        </Link>
      </Gate>
    );
  }
  if (user.role === "provider" || user.role === "admin") {
    const home = user.role === "admin" ? "/admin" : "/provider";
    return (
      <Gate>
        <Mark className="mx-auto h-12 w-12" />
        <h1 className="mt-4 text-2xl font-bold">This area is for carriers</h1>
        <p className="mt-2 text-[15px] text-steel">
          The fleet dashboard is for driver and fleet-manager accounts. Your
          {user.role === "admin" ? " admin console" : " shop dashboard"} is one click away.
        </p>
        <Link href={home} className="btn mt-6 w-full !py-3">
          {user.role === "admin" ? "Open admin console" : "Open my shop dashboard"}
        </Link>
        <Link href="/" className="mt-4 inline-block text-sm font-medium text-steel hover:text-ink hover:underline">
          ← Back to the site
        </Link>
      </Gate>
    );
  }

  // Exact order the client asked for; everything else stays reachable from
  // the dashboard and in-page links, just not in the tab bar.
  const groups: { label: string; items: NavItem[] }[] = [
    {
      label: "",
      items: [
        { href: "/dashboard", label: "Dashboard", icon: "gauge" },
        { href: "/fleet", label: "Trucks", icon: "truck" },
        { href: "/trailers", label: "Trailers", icon: "trailer" },
        { href: "/drivers", label: "Drivers", icon: "users" },
        {
          href: "/work-orders", label: "Work orders", icon: "clipboard",
          children: [
            { href: "/work-orders/mobile", label: "Mobile app", icon: "clipboard", soon: true },
            { href: "/work-orders/telegram", label: "Telegram", icon: "clipboard", soon: true },
            { href: "/work-orders", label: "Manual", icon: "clipboard" },
          ],
        },
        { href: "/ai-dispatch", label: "AI Dispatch", icon: "bot", soon: true },
        { href: "/reports", label: "Reports", icon: "report" },
        { href: "/fuel", label: "Fuel", icon: "fuel", soon: true },
        { href: "/toll", label: "Toll", icon: "toll", soon: true },
        { href: "/map", label: "Map", icon: "map" },
      ],
    },
  ];
  // Mobile pills are flat: a dropdown contributes its children instead.
  const allItems = groups.flatMap((g) => g.items.flatMap((i) => i.children ?? [i]));

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="min-h-screen bg-mist">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col bg-charcoal lg:flex">
        <Link href="/" className="flex items-center gap-2.5 px-5 pb-4 pt-5">
          <Mark />
          <span className="display text-xl font-bold tracking-tight text-white">YourFleet</span>
        </Link>
        <nav className="flex-1 overflow-y-auto px-3 py-2">
          {groups.map((g, gi) => (
            <div key={g.label || gi} className="mb-1.5">
              {g.label && <p className="px-3 pb-1 pt-2 text-xs text-white/40">{g.label}</p>}
              <div className="space-y-0.5">
                {g.items.map((item) =>
                  item.children
                    ? <NavDropdown key={item.href} item={item} pathname={pathname} />
                    : <SideLink key={item.href} item={item} pathname={pathname} />)}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-white/10 px-5 py-4">
          {user.carrier_name ? (
            <>
              <p className="truncate text-sm font-semibold text-white">{user.carrier_name}</p>
              <p className="truncate text-xs text-white/50">
                {[user.mc_number && `MC ${user.mc_number}`, user.dot_number && `DOT ${user.dot_number}`]
                  .filter(Boolean).join(" · ") || user.role.replace("_", " ")}
              </p>
              <p className="mt-0.5 truncate text-xs text-white/50">{user.full_name}</p>
            </>
          ) : (
            <>
              <p className="truncate text-sm font-semibold text-white">{user.full_name}</p>
              <p className="text-xs text-white/50">{user.role.replace("_", " ")}</p>
            </>
          )}
          <button
            onClick={signOut}
            className="mt-3 w-full rounded-lg border border-white/20 px-3.5 py-1.5 text-sm font-semibold text-white/85 transition-colors hover:border-white/50 hover:text-white"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Content column */}
      <div className="flex min-h-screen flex-col lg:ml-60">
        <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-panel px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <Link href="/" className="lg:hidden" aria-label="YourFleet home"><Mark /></Link>
            <span className="display truncate text-lg font-bold">{title}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-steel sm:inline">{today}</span>
          </div>
        </div>

        {/* Mobile nav pills */}
        <nav className="flex gap-1.5 overflow-x-auto border-b border-line bg-panel px-4 py-2 lg:hidden">
          {allItems.map((item) => {
            const active = isActive(item.href, pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  active ? "bg-charcoal text-white" : "border border-line text-steel hover:text-ink"
                }`}
              >
                <NavIcon name={item.icon} className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
