#!/usr/bin/env node
// CAD Champions — seed results for checking the results pages (Prompt 7).
//
//   node scripts/cc-seed-results.mjs <student email>            # DRY RUN: prints the plan, touches nothing
//   node scripts/cc-seed-results.mjs <student email> --write    # writes to the database in .env.local
//
// For the given CC student it creates five attempts of the free test
// "diagnostic-v1" (0080), spread over the last 60 days:
//   1. graded, about 25 %      (60 days ago)
//   2. graded, about 55 %      (40 days ago)
//   3. graded, about 88 %      (20 days ago)
//   4. provisional             (10 days ago: drawing waiting for a trainer)
//   5. expired, no files       (2 days ago)
// Each scored attempt gets fake cc_submissions rows (storage_path "seed/…",
// no real file), cc_task_results and cc_aspect_results chosen so the score
// lands near the target, cc_skill_scores, and the attempt's percent / band.
// results_email_sent_at is set (when migration 0081 has run) so NO email goes
// to the student. Every inserted attempt id is appended to
// docs/TEST_DATA_CLEANUP.md; deleting an attempt cascades to its rows.
//
// WARNING: .env.local points at PRODUCTION Supabase. Only run --write when the
// owner asks for it, with a test account's email.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const email = args.find((a) => !a.startsWith("--"));
const TEST_SLUG = "diagnostic-v1";
const WEIGHTS = { 1: 10, 2: 5, 3: 30, 4: 10, 5: 15, 6: 30 };

const PLAN = [
  { key: "weak", target: 25, daysAgo: 60, kind: "graded" },
  { key: "medium", target: 55, daysAgo: 40, kind: "graded" },
  { key: "strong", target: 88, daysAgo: 20, kind: "graded" },
  { key: "provisional", target: 60, daysAgo: 10, kind: "provisional" },
  { key: "expired", target: null, daysAgo: 2, kind: "expired" },
];

if (!email || !email.includes("@")) {
  console.error("Usage: node scripts/cc-seed-results.mjs <student email> [--write]");
  process.exit(1);
}

console.log(`${WRITE ? "WRITE" : "DRY RUN"}: seed results for ${email} on test "${TEST_SLUG}"`);
for (const p of PLAN) {
  console.log(`  - ${p.key.padEnd(11)} ${p.kind.padEnd(11)} target ${p.target == null ? "—" : p.target + " %"}, started ${p.daysAgo} days ago`);
}
console.log("  rows per scored attempt: 4 cc_submissions (fake path), 4 cc_task_results, aspect results, 6 cc_skill_scores");
console.log("  expired attempt: 4 cc_task_results without files, 6 cc_skill_scores (not assessed)");
if (!WRITE) {
  console.log("\nNothing written. Add --write to insert (production database!).");
  process.exit(0);
}

// ─── write mode ────────────────────────────────────────────────────────────

function readEnv() {
  const file = path.join(ROOT, ".env.local");
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = readEnv();
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function rest(method, pathAndQuery, body, extraHeaders = {}) {
  const res = await fetch(`${URL_}/rest/v1/${pathAndQuery}`, {
    method,
    headers: { ...H, ...extraHeaders },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${pathAndQuery}: ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const get = (q) => rest("GET", q);
const insert = (table, rows) => rest("POST", table, rows, { Prefer: "return=representation" });

function bandFor(p) {
  return p >= 85 ? "competition_ready" : p >= 65 ? "competitive" : p >= 40 ? "developing" : "beginner";
}
function levelFor(p) {
  return p >= 90 ? 6 : p >= 75 ? 5 : p >= 60 ? 4 : p >= 40 ? 3 : p >= 20 ? 2 : 1;
}
const r2 = (n) => Math.round(n * 100) / 100;

/** Picks pass/fail and judgement scores so each area lands near `target`. */
function choose(aspects, target, provisional) {
  const out = new Map();
  const byArea = new Map();
  for (const a of aspects) {
    if (!byArea.has(a.skill_area_id)) byArea.set(a.skill_area_id, []);
    byArea.get(a.skill_area_id).push(a);
  }
  for (const list of byArea.values()) {
    const max = list.reduce((s, a) => s + Number(a.max_points), 0);
    let earned = 0;
    const meas = list.filter((a) => a.type === "measurement").sort((x, y) => Number(y.max_points) - Number(x.max_points));
    for (const a of list.filter((x) => x.type === "judgement")) {
      if (provisional) {
        out.set(a.id, { judgement_score: null, points: 0 });
        continue;
      }
      const s = Math.max(0, Math.min(3, Math.round((3 * target) / 100)));
      const pts = r2((Number(a.max_points) * s) / 3);
      earned += pts;
      out.set(a.id, { judgement_score: s, points: pts });
    }
    for (const a of meas) {
      const pass = earned + Number(a.max_points) <= (max * target) / 100 + 0.01;
      if (pass) earned += Number(a.max_points);
      out.set(a.id, { passed: pass, points: pass ? Number(a.max_points) : 0 });
    }
  }
  return out;
}

function score(tasks, aspects, chosen, weights) {
  const area = new Map();
  for (const a of aspects) {
    const cur = area.get(a.skill_area_id) ?? { e: 0, m: 0 };
    cur.e += chosen.get(a.id)?.points ?? 0;
    cur.m += Number(a.max_points);
    area.set(a.skill_area_id, cur);
  }
  let w = 0;
  let acc = 0;
  const areas = [];
  for (const id of [1, 2, 3, 4, 5, 6]) {
    const v = area.get(id);
    if (!v || v.m <= 0) {
      areas.push({ id, assessed: false });
      continue;
    }
    const p = r2((v.e / v.m) * 100);
    areas.push({ id, assessed: true, earned: r2(v.e), max: r2(v.m), percent: p, level: levelFor(p) });
    w += weights[id];
    acc += weights[id] * p;
  }
  const total = r2([...area.values()].reduce((s, v) => s + v.e, 0));
  const max = r2(tasks.reduce((s, t) => s + Number(t.max_points), 0));
  return { areas, percent: w ? r2(acc / w) : null, total, max };
}

const [profile] = await get(`cc_profiles?select=id,email&email=eq.${encodeURIComponent(email)}`);
if (!profile) throw new Error(`No cc_profiles row for ${email}`);
const [test] = await get(`cc_tests?select=id,slug,time_limit_minutes&slug=eq.${TEST_SLUG}`);
if (!test) throw new Error(`Test ${TEST_SLUG} not found (run 0080)`);
const tasks = await get(`cc_test_tasks?select=id,position,max_points,grading_mode,skill_area_id&test_id=eq.${test.id}&order=position`);
const aspects = await get(`cc_task_aspects?select=id,task_id,type,max_points,skill_area_id&task_id=in.(${tasks.map((t) => t.id).join(",")})`);
const areaRows = await get("cc_skill_areas?select=id,weight_percent");
const weights = { ...WEIGHTS };
for (const a of areaRows) weights[a.id] = Number(a.weight_percent);
const has0081 = await get("cc_attempts?select=results_email_sent_at&limit=1").then(() => true, () => false);

const inserted = [];
for (const p of PLAN) {
  const started = new Date(Date.now() - p.daysAgo * 86_400_000);
  const submitted = new Date(started.getTime() + Math.min(85, test.time_limit_minutes ?? 85) * 60_000);
  const attemptId = randomUUID();
  const expired = p.kind === "expired";
  const provisional = p.kind === "provisional";
  const chosen = expired ? new Map() : choose(aspects, p.target, provisional);
  const s = expired ? { areas: [1, 2, 3, 4, 5, 6].map((id) => ({ id, assessed: false })), percent: null, total: 0, max: 0 } : score(tasks, aspects, chosen, weights);

  await insert("cc_attempts", {
    id: attemptId,
    user_id: profile.id,
    test_id: test.id,
    started_at: started.toISOString(),
    deadline_at: test.time_limit_minutes ? new Date(started.getTime() + test.time_limit_minutes * 60_000).toISOString() : null,
    submitted_at: submitted.toISOString(),
    submit_reason: expired ? "timeout" : "manual",
    status: expired ? "expired" : provisional ? "provisional" : "graded",
    total_score: s.total,
    max_score: s.max,
    percent: s.percent,
    band: s.percent == null ? null : bandFor(s.percent),
    graded_at: p.kind === "graded" ? submitted.toISOString() : null,
    ...(has0081 && !expired ? { results_email_sent_at: new Date().toISOString(), ...(provisional ? { provisional_percent: s.percent } : {}) } : {}),
  });

  for (const t of tasks) {
    let submissionId = null;
    if (!expired) {
      submissionId = randomUUID();
      await insert("cc_submissions", {
        id: submissionId,
        attempt_id: attemptId,
        task_id: t.id,
        user_id: profile.id,
        storage_path: `seed/${profile.id}/${attemptId}/${t.id}/seed.${t.grading_mode === "ai_drawing" ? "pdf" : "step"}`,
        file_name: t.grading_mode === "ai_drawing" ? "seed-drawing.pdf" : "seed-part.step",
        file_size: 1024,
        uploaded_at: submitted.toISOString(),
      });
    }
    const own = aspects.filter((a) => a.task_id === t.id);
    const earned = r2(own.reduce((sum, a) => sum + (chosen.get(a.id)?.points ?? 0), 0));
    const waiting = provisional && t.grading_mode === "ai_drawing";
    const [tr] = await insert("cc_task_results", {
      attempt_id: attemptId,
      task_id: t.id,
      user_id: profile.id,
      submission_id: submissionId,
      max_points: t.max_points,
      status: expired ? "final" : waiting ? "ai_pending_review" : t.grading_mode === "auto_step" ? "auto" : "final",
      auto_score: t.grading_mode === "auto_step" && !expired ? earned : null,
      final_score: expired ? 0 : waiting ? null : earned,
      error_code: expired ? "E_NO_FILE" : null,
      feedback_en: expired ? null : "Seed data: sample feedback for checking the results page.",
      feedback_ar: expired ? null : "بيانات تجريبية: ملاحظات نموذجية لفحص صفحة النتائج.",
      graded_at: expired || waiting ? null : submitted.toISOString(),
    });
    if (!expired && own.length) {
      await insert(
        "cc_aspect_results",
        own.map((a) => {
          const c = chosen.get(a.id) ?? {};
          return {
            task_result_id: tr.id,
            aspect_id: a.id,
            user_id: profile.id,
            passed: a.type === "measurement" ? !!c.passed : null,
            judgement_score: a.type === "judgement" ? (c.judgement_score ?? null) : null,
            points_awarded: c.points ?? 0,
          };
        })
      );
    }
  }

  await insert(
    "cc_skill_scores",
    s.areas.map((a) => ({
      attempt_id: attemptId,
      skill_area_id: a.id,
      user_id: profile.id,
      earned_points: a.assessed ? a.earned : null,
      max_points: a.assessed ? a.max : null,
      percent: a.assessed ? a.percent : null,
      level: a.assessed ? a.level : null,
      assessed: a.assessed,
    }))
  );
  inserted.push({ id: attemptId, key: p.key, percent: s.percent });
  console.log(`  inserted ${p.key}: ${attemptId} (${s.percent == null ? "no score" : s.percent + " %"})`);
}

const today = new Date().toISOString().slice(0, 10);
const lines = [
  "",
  `## CAD Champions results seed (${today}, scripts/cc-seed-results.mjs)`,
  `Student ${email}. Deleting each cc_attempts row cascades to its submissions (fake paths, no files), task results, aspect results and skill scores.`,
  "",
  "| Attempt | Id |",
  "|---|---|",
  ...inserted.map((x) => `| ${x.key} | \`${x.id}\` |`),
  "",
];
fs.appendFileSync(path.join(ROOT, "docs", "TEST_DATA_CLEANUP.md"), lines.join("\n"));
console.log("Logged to docs/TEST_DATA_CLEANUP.md");
