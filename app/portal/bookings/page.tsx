import { requirePortalTenant } from "@/lib/portal-auth";
import { recentBookings } from "@/lib/admin-queries";
import { pageParam } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { BookingsTable } from "@/components/records/tables";
import { Pager } from "@/components/records/pager";

export const dynamic = "force-dynamic";

export default async function PortalBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { tenantId } = await requirePortalTenant();
  const page = pageParam((await searchParams).page);
  const bookings = await recentBookings(tenantId, page);

  return (
    <main>
      <h1 className="text-xl font-semibold">Bookings</h1>
      <p className="text-sm text-muted-foreground">
        Appointments your receptionist put on the calendar.
      </p>
      <Card className="mt-4 p-0">
        <BookingsTable rows={bookings.rows} page={page} />
      </Card>
      <Pager basePath="/portal/bookings" page={page} hasMore={bookings.hasMore} />
    </main>
  );
}
