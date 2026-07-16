import { requireAdmin } from "@/lib/admin-auth";
import { recentLeads } from "@/lib/admin-queries";
import { setLeadStatus } from "../../../actions";
import { styles, fmtDate, Pager, pageParam } from "../../../ui";

export const dynamic = "force-dynamic";

const LEAD_STATUSES = ["new", "contacted", "qualified", "converted", "closed"];

export default async function TenantLeadsPage({
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
  const leads = await recentLeads(id, page);
  const back = `/admin/tenants/${id}/leads${page > 1 ? `?page=${page}` : ""}`;

  return (
    <main>
      <h1 style={styles.h1}>Leads</h1>
      {sp.perror ? (
        <p style={{ color: "#ef4444", fontSize: 13 }}>{sp.perror}</p>
      ) : null}
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>When</th>
            <th style={styles.th}>Name</th>
            <th style={styles.th}>Contact</th>
            <th style={styles.th}>Intent</th>
            <th style={styles.th}>Details</th>
            <th style={styles.th}>Qualified</th>
            <th style={styles.th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {leads.rows.map((l) => (
            <tr key={l.id}>
              <td style={{ ...styles.td, whiteSpace: "nowrap" }}>{fmtDate(l.created_at)}</td>
              <td style={styles.td}>{l.name || "—"}</td>
              <td style={styles.td}>
                {[l.phone, l.email].filter(Boolean).join(" · ") || "—"}
              </td>
              <td style={styles.td}>{l.intent ?? "—"}</td>
              <td style={{ ...styles.td, color: "#aaa", maxWidth: 380 }}>
                {l.details ?? "—"}
              </td>
              <td style={styles.td}>{l.qualified ? "🔥 yes" : "no"}</td>
              <td style={{ ...styles.td, whiteSpace: "nowrap" }}>
                <form
                  action={setLeadStatus}
                  style={{ display: "flex", gap: 6, alignItems: "center" }}
                >
                  <input type="hidden" name="tenant_id" value={id} />
                  <input type="hidden" name="lead_id" value={l.id} />
                  <input type="hidden" name="back" value={back} />
                  <select
                    name="status"
                    defaultValue={l.status ?? "new"}
                    style={{ ...styles.input, width: "auto", padding: "4px 6px" }}
                  >
                    {LEAD_STATUSES.map((s) => (
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
          {leads.rows.length === 0 ? (
            <tr>
              <td style={styles.td} colSpan={7}>
                No leads {page > 1 ? "on this page" : "yet"}.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <Pager
        basePath={`/admin/tenants/${id}/leads`}
        page={page}
        hasMore={leads.hasMore}
      />
    </main>
  );
}
