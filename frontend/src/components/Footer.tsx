"use client";

import { usePathname } from "next/navigation";

/* Same shell routes as Header: the sidebar layout owns those pages end to end. */
const SHELL_ROUTES =
  /^\/(dashboard|fleet|repairs|bookings|trailers|drivers|issues|tasks|deadlines|comm-log|service-records|expenses|analytics|work-orders|loans|reports|ai-dispatch|fuel|toll)/;

export function Footer() {
  const pathname = usePathname();
  if (SHELL_ROUTES.test(pathname)) return null;

  return (
    <footer className="bg-charcoal text-white/70">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <p className="display text-lg font-bold text-white">YourFleet</p>
        <div className="mt-3 flex flex-wrap justify-between gap-x-8 gap-y-2 text-sm">
          <p className="max-w-[70ch]">
            Truck repair marketplace. Directory data imported from operator-curated
            sources — verify details with the shop before you drive. Marketplace prices
            apply only to verified partner offers booked through YourFleet.
          </p>
          <p>
            Map data © OpenStreetMap contributors ·{" "}
            <a href="/attributions" className="underline hover:text-white">Image credits</a>
          </p>
        </div>
      </div>
    </footer>
  );
}
