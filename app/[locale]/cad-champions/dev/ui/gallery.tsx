"use client";

import * as React from "react";
import { FileX } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  HelpTip,
  NeedHelpButton,
  PageHeader,
  SkeletonCard,
  SkeletonTableRows,
  SkeletonText,
  Spinner,
  StatusChip,
  Stepper,
  Term,
  useToast,
  type StepperStep,
} from "@/components/cad-champions/ui";
import { Ltr } from "@/lib/cad-champions/ltr";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="title-section">{title}</h2>
      {children}
    </section>
  );
}

export function UiGallery() {
  const t = useTranslations("CC.gallery");
  const toast = useToast();
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const steps: StepperStep[] = [
    { id: "upload", label: t("stepper.upload"), description: t("stepper.uploadDesc"), status: "done" },
    { id: "check", label: t("stepper.check"), description: t("stepper.checkDesc"), status: "done" },
    { id: "drawing", label: t("stepper.drawing"), description: t("stepper.drawingDesc"), status: "current" },
    { id: "review", label: t("stepper.review"), description: t("stepper.reviewDesc"), status: "upcoming" },
    {
      id: "submit",
      label: t("stepper.submit"),
      status: "locked",
      lockedReason: t("stepper.lockedReason"),
    },
  ];

  const directionSample = (
    <div className="space-y-4">
      <Button>{t("directions.sampleButton")}</Button>
      <Alert tone="warning" title={t("directions.sampleAlert")}>
        {t("directions.sampleAlertBody")} <Ltr>7850 kg/m³</Ltr>
      </Alert>
      <p className="text-sm text-body">
        {t("directions.fileLabel")} <Ltr>part-01.step</Ltr>
      </p>
      <StatusChip tone="success">{t("directions.sampleChip")}</StatusChip>
      <Stepper steps={steps.slice(0, 3)} orientation="vertical" />
    </div>
  );

  return (
    <div className="container page-stack">
      <PageHeader
        title={t("title")}
        purpose={t("purpose")}
        help={<HelpTip label={t("help.tipLabel")}>{t("help.tipBody")}</HelpTip>}
        actions={<Button variant="secondary">{t("buttons.secondary")}</Button>}
      />

      <Section title={t("sections.buttons")}>
        <Card>
          <div className="flex flex-wrap items-start gap-4">
            <Button>{t("buttons.primary")}</Button>
            <Button variant="secondary">{t("buttons.secondary")}</Button>
            <Button variant="ghost">{t("buttons.ghost")}</Button>
            <Button variant="danger">{t("buttons.danger")}</Button>
            <Button size="sm">{t("buttons.small")}</Button>
            <Button loading loadingText={t("buttons.loadingText")}>
              {t("buttons.loading")}
            </Button>
            <Button disabled disabledReason={t("buttons.disabledReason")}>
              {t("buttons.disabled")}
            </Button>
          </div>
        </Card>
      </Section>

      <Section title={t("sections.cards")}>
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <h3 className="title-card">{t("cards.title")}</h3>
            </CardHeader>
            <CardBody>
              <p>{t("cards.body")}</p>
              <div className="tile mt-4">{t("cards.tile")}</div>
            </CardBody>
          </Card>
          <Card as="section">
            <CardBody>{t("cards.body")}</CardBody>
          </Card>
        </div>
      </Section>

      <Section title={t("sections.chips")}>
        <div className="flex flex-wrap gap-3">
          <StatusChip tone="neutral">{t("chips.neutral")}</StatusChip>
          <StatusChip tone="info">{t("chips.info")}</StatusChip>
          <StatusChip tone="success">{t("chips.success")}</StatusChip>
          <StatusChip tone="warning">{t("chips.warning")}</StatusChip>
          <StatusChip tone="danger">{t("chips.danger")}</StatusChip>
        </div>
      </Section>

      <Section title={t("sections.alerts")}>
        <div className="grid gap-4">
          <Alert tone="info" title={t("alerts.infoTitle")} action={<Button size="sm" variant="secondary">{t("alerts.action")}</Button>}>
            {t("alerts.infoBody")}
          </Alert>
          <Alert tone="success" title={t("alerts.successTitle")} action={<Button size="sm" variant="secondary">{t("alerts.action")}</Button>}>
            {t("alerts.successBody")}
          </Alert>
          <Alert tone="warning" title={t("alerts.warningTitle")} action={<Button size="sm" variant="secondary">{t("alerts.action")}</Button>}>
            {t("alerts.warningBody")}
          </Alert>
          <Alert tone="error" title={t("alerts.errorTitle")} action={<Button size="sm" variant="secondary">{t("alerts.action")}</Button>}>
            {t("alerts.errorBody")}
          </Alert>
        </div>
      </Section>

      <Section title={t("sections.help")}>
        <Card>
          <p className="text-base leading-loose text-body">
            {t("help.sentenceBefore")} <Term id="step-file" /> {t("help.sentenceMiddle")} <Term id="units-mm" />{" "}
            {t("help.sentenceAfter")}{" "}
            <HelpTip label={t("help.tipLabel")} learnMoreSlug="units">
              {t("help.tipBody")}
            </HelpTip>
          </p>
        </Card>
      </Section>

      <Section title={t("sections.empty")}>
        <EmptyState
          icon={FileX}
          title={t("empty.title")}
          description={t("empty.description")}
          action={<Button>{t("empty.action")}</Button>}
        />
      </Section>

      <Section title={t("sections.loading")}>
        <div className="grid gap-6 md:grid-cols-2">
          <SkeletonCard />
          <Card className="space-y-6">
            <SkeletonText lines={4} />
            <SkeletonTableRows rows={3} cols={4} />
            <Spinner label={t("loading.spinner")} />
          </Card>
        </div>
      </Section>

      <Section title={t("sections.toasts")}>
        <div className="flex flex-wrap gap-4">
          <Button variant="secondary" onClick={() => toast.success(t("toasts.successTitle"), t("toasts.successBody"))}>
            {t("toasts.success")}
          </Button>
          <Button variant="secondary" onClick={() => toast.error(t("toasts.errorTitle"), t("toasts.errorBody"))}>
            {t("toasts.error")}
          </Button>
          <Button variant="secondary" onClick={() => toast.info(t("toasts.infoTitle"), t("toasts.infoBody"))}>
            {t("toasts.info")}
          </Button>
        </div>
      </Section>

      <Section title={t("sections.confirm")}>
        <Button variant="danger" onClick={() => setConfirmOpen(true)}>
          {t("confirm.open")}
        </Button>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          tone="danger"
          title={t("confirm.title")}
          consequence={t("confirm.consequence")}
          confirmLabel={t("confirm.confirm")}
          onConfirm={async () => {
            await new Promise((resolve) => setTimeout(resolve, 1200));
            setConfirmOpen(false);
            toast.success(t("confirm.toast"));
          }}
        />
      </Section>

      <Section title={t("sections.stepper")}>
        <Stepper steps={steps} />
      </Section>

      <Section title={t("sections.needHelp")}>
        <Card>
          <p className="text-sm text-body">{t("sections.needHelp")}</p>
        </Card>
        {/* Sample values for the dev gallery only. */}
        <NeedHelpButton pageName={t("title")} whatsappNumber="97400000000" supportEmail="info@gestaltung360.com" />
      </Section>

      <Section title={t("sections.directions")}>
        <div className="grid gap-6 md:grid-cols-2">
          <div dir="ltr" className="neu space-y-4 p-6 text-start">
            <p className="kicker text-mutedtext">{t("directions.ltr")}</p>
            {directionSample}
          </div>
          <div dir="rtl" className="neu space-y-4 p-6 text-start">
            <p className="kicker text-mutedtext">{t("directions.rtl")}</p>
            {directionSample}
          </div>
        </div>
      </Section>
    </div>
  );
}
