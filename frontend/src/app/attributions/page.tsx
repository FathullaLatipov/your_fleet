import attributions from "../../../public/stock/attributions.json";

export const metadata = { title: "Image credits — YourFleet" };

interface Credit {
  file: string;
  title: string | null;
  creator: string | null;
  license: string | null;
  source: string | null;
}

const LICENSE_LABEL: Record<string, string> = {
  pdm: "Public Domain",
  cc0: "CC0 (Public Domain)",
};

export default function AttributionsPage() {
  const rows = attributions as Credit[];
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-bold">Image credits</h1>
      <p className="mt-2 text-steel">
        Illustrative photos used on listings without their own photos come from
        openly licensed sources. Shops add their real photos when they claim
        their listing.
      </p>
      <ul className="mt-6 space-y-3">
        {rows.map((r) => (
          <li key={r.file} className="card flex flex-wrap items-center gap-4 p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/stock/${r.file}`} alt={r.title ?? r.file}
                 className="h-16 w-24 rounded-lg object-cover" />
            <div className="min-w-0 text-sm">
              <p className="font-semibold">{r.title ?? r.file}</p>
              <p className="text-steel">
                {r.creator && <>by {r.creator} · </>}
                {LICENSE_LABEL[r.license ?? ""] ?? r.license}
                {r.source && (
                  <>
                    {" · "}
                    <a href={r.source} target="_blank" rel="noopener noreferrer"
                       className="text-pine hover:underline">source</a>
                  </>
                )}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
