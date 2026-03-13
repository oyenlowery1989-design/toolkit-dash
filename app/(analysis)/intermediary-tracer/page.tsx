import { IntermediaryTracerPanel } from "@/components/intermediary-tracer/IntermediaryTracerPanel";

export const metadata = {
  title: "Intermediary Tracer | Stellar Toolkit",
  description: "Trace the real origin of Stellar accounts created through exchange intermediaries.",
};

export default function IntermediaryTracerPage() {
  return <IntermediaryTracerPanel />;
}
