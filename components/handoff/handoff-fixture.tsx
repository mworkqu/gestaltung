"use client";

// TEST-ONLY: all handoff states side by side with inert handlers.

import { useState } from "react";

import { HandoffView } from "./handoff-view";

export function HandoffFixture() {
  const [phone, setPhone] = useState("");
  const [invalid, setInvalid] = useState(false);
  return (
    <>
      <HandoffView state="loading" />
      <HandoffView state="expired" />
      <HandoffView state="limit" />
      <HandoffView state="error" onRetry={() => undefined} />
      <HandoffView state="notReady" />
      <HandoffView
        state="phone"
        phone={{
          value: phone,
          onChange: setPhone,
          onSave: () => setInvalid(true),
          onSkip: () => undefined,
          invalid,
        }}
      />
    </>
  );
}
