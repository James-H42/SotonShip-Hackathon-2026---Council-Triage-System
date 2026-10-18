import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui";
import { getResident } from "@/lib/auth";
import { getResidentAccount } from "@/lib/repo/residents";
import { ReportWizard, type WizardAccount } from "./ReportWizard";

export const metadata: Metadata = { title: "Report a problem" };

// The category is chosen inside the form, so there is no ?category= shortcut any more.
async function Wizard() {
  const session = await getResident();
  const a = session ? getResidentAccount(session.residentId) : null;
  const account: WizardAccount = a ? { firstName: a.firstName ?? "", lastName: a.lastName ?? "", email: a.email, phone: a.phone ?? "" } : null;
  return <ReportWizard account={account} />;
}

export default function ReportPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Wizard />
    </Suspense>
  );
}
