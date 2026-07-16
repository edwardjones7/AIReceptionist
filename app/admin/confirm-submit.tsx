"use client";

// The one client component in the admin: a submit button that asks for
// confirmation before letting the form action fire. Used on destructive
// actions (deprovision, delete tenant).

import type { CSSProperties, ReactNode } from "react";

export function ConfirmSubmit({
  message,
  style,
  children,
}: {
  message: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      style={style}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
