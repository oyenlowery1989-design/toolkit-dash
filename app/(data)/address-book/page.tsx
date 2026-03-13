import { Suspense } from "react";
import { AddressBookPanel } from "@/components/address-book/AddressBookPanel";

export default function AddressBookPage() {
  return (
    <Suspense>
      <AddressBookPanel />
    </Suspense>
  );
}
