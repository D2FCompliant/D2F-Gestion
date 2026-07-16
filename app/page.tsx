import SessionShell from "./session-shell";
import { publicBillingConfig } from "../lib/auth/server";

export default function Home() {
  return <SessionShell monthlyPriceEur={publicBillingConfig().amountEur ?? 29} />;
}
