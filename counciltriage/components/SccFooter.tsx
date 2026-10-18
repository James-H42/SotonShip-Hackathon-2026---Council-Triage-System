import Image from "next/image";

/**
 * Footer for the public pages: Southampton City Council contact details only.
 * Address and switchboard number appear on council documents published on southampton.gov.uk;
 * anything else is left to the council's own contact page rather than repeated here.
 */
export function SccFooter({ flush = false }: { flush?: boolean }) {
  return (
    <footer className={flush ? "border-t border-white/10 bg-scc-navy text-white" : "mt-12 bg-scc-navy text-white"}>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 text-sm sm:flex-row sm:items-start sm:justify-between">
        <Image src="/brand/rgbcity-of-opportunity_white.png" alt="Southampton, City of Opportunity" width={180} height={36} unoptimized className="h-9 w-auto self-start" />
        <address className="not-italic text-white/85">
          <p className="font-display text-base font-semibold text-white">Southampton City Council</p>
          <p className="mt-1">Civic Centre, Civic Centre Road, Southampton SO14 7LY</p>
          <p className="mt-1">
            Switchboard:{" "}
            <a href="tel:+442380833000" className="underline hover:text-white">
              023 8083 3000
            </a>
          </p>
          <p className="mt-1">
            <a href="https://www.southampton.gov.uk/contact-us/" className="underline hover:text-white">
              All contact details and opening hours
            </a>
            {" · "}
            <a href="https://www.southampton.gov.uk/" className="underline hover:text-white">
              southampton.gov.uk
            </a>
          </p>
        </address>
      </div>
    </footer>
  );
}
