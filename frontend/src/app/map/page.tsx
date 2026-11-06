"use client";

import { AppShell } from "@/components/AppShell";
import { SearchView } from "@/components/SearchView";

/* The directory map inside the fleet console, so the sidebar stays put.
   On small screens the console adds a row of nav pills under the top bar. */
export default function MapPage() {
  return (
    <AppShell title="Map">
      <SearchView heightClass="h-[calc(100vh-6.5rem)] lg:h-[calc(100vh-3.5rem)]" />
    </AppShell>
  );
}
