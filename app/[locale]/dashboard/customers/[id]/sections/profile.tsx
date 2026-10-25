// Profile: the profiles row plus the auth.users record.
// One Panel of /dashboard/customers/<id>, split out of page.tsx (R8).

import type { CustomerRow } from "@/lib/admin/customer-data";
import { formatPhoneDisplay, toWhatsAppDigits } from "@/lib/phone";
import { Panel, type CustomerFmt } from "../panel";

/** The auth.users record (service key only); null when the key is not set or the user is gone. */
export type CustomerAuth = {
  email: string | null;
  anonymous: boolean;
  joined: string | null;
  lastSignIn: string | null;
  confirmed: string | null;
  provider: string | null;
};

export function ProfileSection({ profile, auth, email, fullName, phone, id, unavailable, f }: {
  profile: CustomerRow | null;
  auth: CustomerAuth | null;
  email: string | null;
  fullName: string | null;
  phone: string | null;
  id: string;
  unavailable?: string;
  f: CustomerFmt;
}) {
  const { t, text, time, yesNo } = f;
  const profileFields: { label: string; value: React.ReactNode }[] = [
    { label: t("fEmail"), value: <span dir="ltr">{text(email)}</span> },
    { label: t("fName"), value: text(fullName) },
    { label: t("fRole"), value: text(profile?.role) },
    {
      label: t("fPhone"),
      value: phone ? (
        toWhatsAppDigits(phone) ? (
          <a href={`https://wa.me/${toWhatsAppDigits(phone)}`} target="_blank" rel="noopener noreferrer" className="font-medium text-cobalt hover:underline" dir="ltr">
            {formatPhoneDisplay(phone)}
          </a>
        ) : (
          <span dir="ltr">{formatPhoneDisplay(phone)}</span>
        )
      ) : (
        "—"
      ),
    },
    { label: t("fLocale"), value: <span dir="ltr">{text(profile?.locale)}</span> },
    { label: t("fPriceCohort"), value: text(profile?.price_cohort) },
    { label: t("fTenant"), value: <span className="font-mono text-[11px]">{text(profile?.tenant_id)}</span> },
    { label: t("fJoined"), value: time(auth?.joined ?? profile?.created_at) },
    { label: t("fLastSignIn"), value: time(auth?.lastSignIn) },
    { label: t("fConfirmed"), value: time(auth?.confirmed) },
    { label: t("fProvider"), value: <span dir="ltr">{text(auth?.provider)}</span> },
    { label: t("fGuest"), value: yesNo(auth?.anonymous) },
    { label: t("fId"), value: <span className="font-mono text-[11px]" dir="ltr">{id}</span> },
  ];

  return (
    <Panel title={t("secProfile")} unavailable={unavailable} empty={!profile && !auth} noneLabel={t("noProfile")}>
      {/* no-scroll: Panel wraps every table in overflow-x-auto */}
      <table className="w-full text-sm">
        <tbody className="divide-y divide-borderstrong/40">
          {profileFields.map((f) => (
            <tr key={f.label}>
              <th scope="row" className="w-[42%] py-2 text-start text-[10px] font-medium uppercase tracking-wider text-faint">
                {f.label}
              </th>
              <td className="py-2 text-[12.5px] text-heading">{f.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
