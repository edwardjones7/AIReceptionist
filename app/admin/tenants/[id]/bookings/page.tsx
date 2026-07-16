import { requireAdmin } from "@/lib/admin-auth";
import { recentBookings } from "@/lib/admin-queries";
import { setBookingStatus } from "../../../actions";
import { styles, fmtDate, Pager, pageParam } from "../../../ui";

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
      <h1 style={styles.h1}>Bookings</h1>
      {sp.perror ? (
        <p style={{ color: "#ef4444", fontSize: 13 }}>{sp.perror}</p>
      ) : null}
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Slot</th>
            <th style={styles.th}>Type</th>
            <th style={styles.th}>Name</th>
            <th style={styles.th}>Contact</th>
            <th style={styles.th}>Booked</th>
            <th style={styles.th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {bookings.rows.map((b) => (
            <tr key={b.id}>
              <td style={{ ...styles.td, whiteSpace: "nowrap" }}>{fmtDate(b.slot_start)}</td>
              <td style={styles.td}>{b.type ?? "—"}</td>
              <td style={styles.td}>{b.name || "—"}</td>
              <td style={styles.td}>
                {[b.phone, b.email].filter(Boolean).join(" · ") || "—"}
              </td>
              <td style={{ ...styles.td, whiteSpace: "nowrap" }}>{fmtDate(b.created_at)}</td>
              <td style={{ ...styles.td, whiteSpace: "nowrap" }}>
                <form
                  action={setBookingStatus}
                  style={{ display: "flex", gap: 6, alignItems: "center" }}
                >
                  <input type="hidden" name="tenant_id" value={id} />
                  <input type="hidden" name="booking_id" value={b.id} />
                  <input type="hidden" name="back" value={back} />
                  <select
                    name="status"
                    defaultValue={b.status ?? "confirmed"}
                    style={{ ...styles.input, width: "auto", padding: "4px 6px" }}
                  >
                    {BOOKING_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    style={{ ...styles.buttonGhost, padding: "4px 10px" }}
                  >
                    Set
                  </button>
                </form>
              </td>
            </tr>
          ))}
          {bookings.rows.length === 0 ? (
            <tr>
              <td style={styles.td} colSpan={6}>
                No bookings {page > 1 ? "on this page" : "yet"}.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <Pager
        basePath={`/admin/tenants/${id}/bookings`}
        page={page}
        hasMore={bookings.hasMore}
      />
    </main>
  );
}
