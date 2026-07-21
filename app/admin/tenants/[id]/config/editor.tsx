"use client";

// JSON textarea with zod-validated save. Field-by-field editing can come
// later — the operator is the founder.

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
      <Textarea
        value={json}
        onChange={(e) => setJson(e.target.value)}
        spellCheck={false}
        rows={32}
        className="min-h-[32rem] font-mono text-xs leading-relaxed"
      />
      {errors.length > 0 ? (
        <ul className="mt-3 list-disc pl-5 text-sm text-destructive">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      ) : null}
      {savedAt ? (
        <p className="mt-3 text-sm text-green-500">
          Saved. Live within ~60s on warm instances.
        </p>
      ) : null}
      <Button onClick={onSave} disabled={pending} className="mt-3">
        {pending ? "Saving…" : "Validate & save"}
      </Button>
    </div>
  );
}
