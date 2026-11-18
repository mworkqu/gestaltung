import { getTranslations } from "next-intl/server";

import { PluginHandoffButtons } from "@/components/admin/plugin-handoff-buttons";
import { Link } from "@/i18n/navigation";
import { scadFileName, type PluginHandoffInfo } from "@/lib/admin/plugin-handoff";
import { timeFormatter } from "@/lib/format/date";
import { formatQar } from "@/lib/format/money";
import { asLocale } from "@/lib/locale";
import { formatPhoneDisplay } from "@/lib/phone";

// "Project from chat" on the lead page: what the client's AI chat sent.
// `info` null = the handoff row could not be read (`migrationMissing` says why).
export async function PluginHandoffPanel({
  locale,
  info,
  migrationMissing,
}: {
  locale: string;
  info: PluginHandoffInfo | null;
  migrationMissing: boolean;
}) {
  const t = await getTranslations("Leads");
  const fmt = timeFormatter(asLocale(locale));

  return (
    <section className="neu space-y-4 p-5 sm:p-6" data-testid="lead-plugin-panel">
      <h2 className="text-base font-bold text-heading">{t("plugin_title")}</h2>
      {!info ? (
        <p className="text-sm text-mutedtext">{migrationMissing ? t("plugin_runMigration") : t("plugin_missing")}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-panel px-2.5 py-0.5 text-[11px] font-semibold text-cobalt shadow-neu-sm">
              {t(`plugin_source_${info.source}`)}
            </span>
            {info.partsTotalQar !== null && (
              <span className="text-body">
                {t("plugin_partsTotal")}: <bdi className="font-semibold tabular-nums text-heading">{formatQar(info.partsTotalQar, locale)}</bdi>
              </span>
            )}
          </div>

          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-faint">{t("plugin_contact")}</dt>
              <dd className="text-body">
                {[info.contactName, info.contactPhone && formatPhoneDisplay(info.contactPhone), info.contactEmail]
                  .filter(Boolean)
                  .map((v, i) => (
                    <bdi key={i} className="me-3 inline-block">
                      {v}
                    </bdi>
                  ))}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-faint">{t("plugin_created")}</dt>
              <dd className="text-body">{info.createdAt ? fmt.format(new Date(info.createdAt)) : "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-faint">{t("plugin_claimed")}</dt>
              <dd className="text-body">{info.claimedAt ? fmt.format(new Date(info.claimedAt)) : t("plugin_notClaimed")}</dd>
            </div>
          </dl>

          {info.requirementQuotes.length > 0 && (
            <div className="space-y-1">
              <h3 className="text-xs font-semibold text-mutedtext">{t("plugin_quotes")}</h3>
              <ul className="list-disc space-y-1 ps-5 text-sm text-body">
                {info.requirementQuotes.map((q, i) => (
                  <li key={i} className="break-words">
                    {q}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {info.cadPrompt && (
            <div className="space-y-1">
              <h3 className="text-xs font-semibold text-mutedtext">{t("plugin_cadPrompt")}</h3>
              <pre className="neu-inset max-h-72 overflow-auto whitespace-pre-wrap break-words p-3 text-xs text-body">{info.cadPrompt}</pre>
            </div>
          )}

          {info.openscad && (
            <PluginHandoffButtons
              code={info.openscad}
              fileName={scadFileName(info.projectName)}
              labels={{ copy: t("plugin_copyCode"), copied: t("plugin_copied"), download: t("plugin_download") }}
            />
          )}

          {info.projectId ? (
            <Link
              href={`/projects/${info.projectId}?view=page`}
              className="inline-flex min-h-11 items-center rounded-full bg-cobalt px-5 text-sm font-semibold text-white hover:bg-cobalt-hover"
            >
              {t("plugin_open")}
            </Link>
          ) : (
            <p className="text-sm text-mutedtext">{t("plugin_notClaimed")}</p>
          )}
        </>
      )}
    </section>
  );
}
