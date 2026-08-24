"use client";

import type { ComponentPropsWithoutRef, MouseEvent } from "react";
import { APP_STORE_URL } from "@/lib/app-store";

declare global {
  interface Window {
    oaiq?: (
      command: "measure",
      eventName: string,
      properties: {
        type: "customer_action";
        amount: number;
        currency: string;
      },
    ) => void;
  }
}

type TrackedAppStoreLinkProps = Omit<ComponentPropsWithoutRef<"a">, "href">;

export default function TrackedAppStoreLink({
  onClick,
  ...props
}: TrackedAppStoreLinkProps) {
  function measureAppStoreClick(event: MouseEvent<HTMLAnchorElement>) {
    window.oaiq?.("measure", "app_store_click", {
      type: "customer_action",
      amount: 0,
      currency: "USD",
    });
    onClick?.(event);
  }

  return <a {...props} href={APP_STORE_URL} onClick={measureAppStoreClick} />;
}
