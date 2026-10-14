"use client";

import type { Target } from "@/app/[locale]/cad-champions/admin/tests/content-actions";
import type { CcCompetitionModule, CcSkillArea, CcTaskAspect } from "@/lib/cad-champions/db/types";
import { isReferenceComplete } from "@/lib/cad-champions/grader/mapping";

import { AspectsEditor } from "./aspects-editor";
import { GradeSamplePanel } from "./grade-sample-panel";
import { ReferencePanel } from "./reference-panel";
import { RubricEditor } from "./rubric-editor";

// The marking tools under a saved task or exercise: aspects always;
// reference data + "Grade a sample" for STEP tasks; the rubric for drawings.

export interface ContentRow {
  id: string;
  grading_mode: string;
  grader_mode: string | null;
  reference_data: unknown;
  rubric: unknown;
  max_points: number;
  skill_area_id: number | null;
  competition_module: string | null;
}

export function ContentPanels({
  kind,
  row,
  aspects,
  skills,
  modules,
  graderReady,
}: {
  kind: Target["kind"];
  row: ContentRow;
  aspects: CcTaskAspect[];
  skills: Pick<CcSkillArea, "id" | "name_en" | "name_ar">[];
  modules: Pick<CcCompetitionModule, "code" | "name_en" | "name_ar">[];
  graderReady: boolean;
}) {
  const target: Target = { kind, id: row.id };
  const maxPoints = Number(row.max_points) || 0;
  return (
    <div className="flex flex-col gap-8">
      {row.grading_mode === "auto_step" ? (
        <>
          <ReferencePanel target={target} reference={row.reference_data} graderReady={graderReady} isAssembly={row.grader_mode === "assembly"} />
          <GradeSamplePanel target={target} graderReady={graderReady} referenceReady={isReferenceComplete(row.reference_data)} />
        </>
      ) : null}
      {row.grading_mode === "ai_drawing" ? <RubricEditor target={target} rubric={row.rubric} maxPoints={maxPoints} /> : null}
      <AspectsEditor
        target={target}
        aspects={aspects}
        skills={skills}
        modules={modules}
        maxPoints={maxPoints}
        gradingMode={row.grading_mode}
        skillAreaId={row.skill_area_id}
        competitionModule={row.competition_module}
      />
    </div>
  );
}
