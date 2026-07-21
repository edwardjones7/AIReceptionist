import { requireAdmin } from "@/lib/admin-auth";
import { recentBookings } from "@/lib/admin-queries";
import { pageParam } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BookingsTable } from "@/components/records/tables";
import { Pager } from "@/components/records/pager";
import { setBookingStatus } from "../../../actions";

export const dynamic = "force-dynamic";

const BOOKING_STATUSES = ["confirmed", "completed", "cancelled", "no_show"];

export default async function TenantBookingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; perror?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const page = pageParam(sp.page);
  const bookings = await recentBookings(id, page);
  const back = `/admin/tenants/${id}/bookings${page > 1 ? `?page=${page}` : ""}`;

  return (
    <main>
      <h1 className="text-xl font-semibold">Bookings</h1>
      {sp.perror ? <p className="mt-2 text-sm text-destructive">{sp.perror}</p> : null}
      <Card className="mt-4 p-0">
        <BookingsTable
          rows={bookings.rows}
          page={page}
          actionSlot={(b) => (
            <form action={setBookingStatus} className="flex items-center gap-1.5">
              <input type="hidden" name="tenant_id" value={id} />
              <input type="hidden" name="booking_id" value={b.id} />
              <input type="hidden" name="back" value={back} />
              <select
                name="status"
                defaultValue={b.status ?? "confirmed"}
                className="rounded-md border border-input bg-background px-2 py-1 text-xs"
              >
                {BOOKING_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <Button type="submit" variant="outline" size="sm" className="h-7 px-2 text-xs">
                Set
              </Button>
            </form>
          )}
        />
      </Card>
      <Pager
        basePath={`/admin/tenants/${id}/bookings`}
        page={page}
        hasMore={bookings.hasMore}
      />
    </main>
  );
}
