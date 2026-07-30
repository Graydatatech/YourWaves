"use client";

import { useState } from "react";
import { Button, Sheet } from "@/components/ui";

/**
 * The Sheet needs open/close state, so the styleguide wraps it in this tiny
 * client island. Strings are passed in from the server panel so the demo can
 * be rendered in either locale.
 */
export function SheetDemo({
  openLabel,
  title,
  body,
  closeLabel,
}: {
  openLabel: string;
  title: string;
  body: string;
  closeLabel: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {openLabel}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        <p>{body}</p>
        <Button fullWidth className="my-5" onClick={() => setOpen(false)}>
          {closeLabel}
        </Button>
      </Sheet>
    </>
  );
}
