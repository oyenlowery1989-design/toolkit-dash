import { TracerV2Panel } from "@/components/tracer-v2/TracerV2Panel";

export const metadata = {
  title: "Tracer v2 | Stellar Toolkit",
  description: "Operator-level analysis: fingerprint, bulk trace, watchlist, and flow graph.",
};

export default function TracerV2Page() {
  return <TracerV2Panel />;
}
