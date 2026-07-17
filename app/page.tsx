import SessionShell from "./session-shell";
import { publicBillingConfig } from "../lib/auth/server";

export default function Home() {
  const billing = publicBillingConfig();
  return <SessionShell monthlyPriceEur={billing.amountEur ?? 29} annualPriceEur={billing.annualAmountEur ?? 290} />;
}
