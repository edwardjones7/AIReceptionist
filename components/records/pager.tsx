// "← Newer / Older →" links driven by a ?page= search param. extraQuery
// preserves other params (e.g. range) across pages.

import Link from "next/link";

export function Pager({
  basePath,
  page,
  hasMore,
  extraQuery,
}: {
  basePath: string;
  page: number;
  hasMore: boolean;
  extraQuery?: string;
}) {
  if (page <= 1 && !hasMore) return null;
  const q = (p: number) => `${basePath}?page=${p}${extraQuery ? `&${extraQuery}` : ""}`;
  return (
    <p className="mt-4 flex gap-5 text-sm">
      {page > 1 ? (
        <Link href={q(page - 1)} className="text-primary hover:underline">
          ← Newer
        </Link>
      ) : null}
      {hasMore ? (
        <Link href={q(page + 1)} className="text-primary hover:underline">
          Older →
        </Link>
      ) : null}
    </p>
  );
}
