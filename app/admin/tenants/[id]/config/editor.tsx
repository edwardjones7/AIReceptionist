"use client";

// The one client component in the dashboard: a JSON textarea with zod-validated
// save. Field-by-field editing can come later — the operator is the founder.

import { useState, useTransition } from "react";
import { saveTenantConfig } from "../../../actions";

export default function ConfigEditor({
  tenantId,
  initialJson,
}: {
  tenantId: string;
  initialJson: string;
}) {
  const [json, setJson] = useState(initialJson);
  const [errors, setErrors] = useState<string[]>([]);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  function onSave() {
    startTransition(async () => {
      const res = await saveTenantConfig(tenantId, json);
      if (res.ok) {
        setErrors([]);
        setSavedAt(Date.now());
      } else {
        setErrors(res.errors ?? ["Save failed."]);
        setSavedAt(null);
      }
    });
  }

  return (
    <div>
      <textarea
        value={json}
        onChange={(e) => setJson(e.target.value)}
        spellCheck={false}
        rows={32}
        style={{
          width: "100%",
          boxSizing: "border-box",
          background: "#0a0a0a",
          color: "#ededed",
          border: "1px solid #333",
          borderRadius: 6,
          padding: 12,
          fontFamily: "inherit",
          fontSize: 12.5,
          lineHeight: 1.5,
        }}
      />
      {errors.length > 0 ? (
        <ul style={{ color: "#ef4444", fontSize: 13, paddingLeft: 18 }}>
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      ) : null}
      {savedAt ? (
        <p style={{ color: "#22c55e", fontSize: 13 }}>
          Saved. Live within ~60s on warm instances.
        </p>
      ) : null}
      <button
        onClick={onSave}
        disabled={pending}
        style={{
          background: "#a200ff",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          padding: "9px 18px",
          fontFamily: "inherit",
          fontSize: 13,
          fontWeight: 600,
          cursor: pending ? "wait" : "pointer",
          opacity: pending ? 0.6 : 1,
          marginTop: 8,
        }}
      >
        {pending ? "Saving…" : "Validate & save"}
      </button>
    </div>
  );
}
