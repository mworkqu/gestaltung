"use client";

// "Try it" (P5-17g) — the behaviour preview's controls, clock and status line.
//
// useSim() runs the pure model (lib/studio/sim) at 20 Hz while Try it is on:
// inputs live in a ref (a slider drag never re-renders the scene), the state
// is published to React only when something visible changes (signature), and
// the 3D scene reads the latest frame from a ref every frame. Optional beeps:
// WebAudio, only after the person turns the sound on (a click = a gesture),
// off by default.
//
// TryItPanel = the controls derived from the INPUT parts (soil slider,
// motion toggle, press-and-hold button …) with the threshold as a small
// number next to the slider. Overlay at the canvas bottom from md up, a sheet
// below the canvas on phones; 44 px targets; RTL mirrored. data-outputs
// ("pump:on,ring:on") exposes the state for tests. Servos on a servo driver
// (a robot arm, Part E) get one angle slider each up to JOINT_SLIDERS_MAX,
// else a joint picker + one slider.
//
// Only imported by Wiring3DView (the lazy 3D chunk).

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { Volume2, VolumeX } from "lucide-react";

import type { Connection } from "@/lib/studio/connections";
import type { Locale } from "@/lib/studio/netlist";
import { STEP_ACCENT } from "@/lib/studio/palette";
import type { LibraryPart, StudioDoc } from "@/lib/studio/schema";
import { JOINT_SLIDERS_MAX, simModel, SIM_DT, type SimControl, type SimModel } from "@/lib/studio/sim/model";
import {
  activeWires,
  effects,
  initialInputs,
  initialState,
  isMoving,
  outputsAttr,
  signature,
  step,
  type SimInputs,
  type SimState,
} from "@/lib/studio/sim/step";
import { cn } from "@/lib/utils";
import type { SimFrame } from "./sim-scene";

const accent = STEP_ACCENT.wiring;
/** Loose `t` (keys are built from kinds). */
type T = (key: string, values?: Record<string, string | number>) => string;
const useSimT = () => useTranslations("Studio.views.sim") as unknown as T;

// ── Words ───────────────────────────────────────────────────────────────────

const num = (v: number) => String(Math.round(v));

function valueText(t: T, c: SimControl, v: number): string {
  if (c.type !== "slider") return "";
  if (c.unit === "h") return `${num(v)}:00`;
  return `${num(v)} ${t(`unit.${c.unit}`)}`.replace(" %", "%").replace(" °", "°");
}

export function statusLine(t: T, model: SimModel, s: SimState): string {
  const cause = s.cause === "knob" ? t("cause.knob", { v: num((s.level ?? 0) * 100) }) : t(`cause.${s.cause}`);
  const parts = effects(s).map((e) => {
    if (e.kind === "servo") return t("effect.servo", { angle: num(e.angle ?? 0) });
    if (e.kind === "ring" && e.on) return t("effect.ringOn", { colour: t(`colour.${e.colourName ?? "warm"}`) });
    return t(`effect.${e.kind}${e.on ? "On" : "Off"}`);
  });
  return parts.length ? t("status", { cause, effects: parts.join(t("sep")) }) : cause;
}

function screenText(t: T, model: SimModel, s: SimState): string {
  const p = model.controls.find((c) => c.id === model.primary);
  let reading = t("read.ready");
  if (p && s.reading !== null) {
    const v = num(s.reading);
    switch (p.kind) {
      case "motion":
        reading = s.active ? t("read.motion") : t("read.noMotion");
        break;
      case "soil":
      case "temperature":
      case "humidity":
      case "distance":
      case "light":
      case "tilt":
      case "time":
        reading = t(`read.${p.kind}`, { v });
        break;
      case "knob":
        reading = t("read.knob", { v: num(s.level * 100) });
        break;
      default:
        break;
    }
  }
  const pump = model.outputs.some((o) => o.kind === "pump");
  const action = s.active ? (pump ? t("screen.watering") : t("screen.on")) : t("screen.ok");
  return `${reading} · ${action}`;
}

// ── Beeps (WebAudio, off by default) ───────────────────────────────────────

function beep(ctx: AudioContext) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "square";
  o.frequency.value = 1400;
  g.gain.setValueAtTime(0.0001, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.03, ctx.currentTime + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.09);
  o.connect(g).connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + 0.1);
}

// ── The clock ───────────────────────────────────────────────────────────────

export type Sim = {
  model: SimModel;
  inputs: SimInputs;
  state: SimState;
  frame: RefObject<SimFrame | null>;
  moving: boolean;
  setValue: (id: string, v: number) => void;
  setThreshold: (id: string, v: number) => void;
  press: (id: string) => void;
  release: (id: string) => void;
  sound: boolean;
  toggleSound: () => void;
  status: string;
};

export function useSim({
  on,
  doc,
  getPart,
  connections,
  reduced,
  locale,
}: {
  on: boolean;
  doc: StudioDoc;
  getPart: (id: string) => LibraryPart | undefined;
  connections: Connection[];
  reduced: boolean;
  locale: Locale;
}): Sim | null {
  const t = useSimT();
  const model = useMemo(
    () => (on ? simModel({ spec: doc.spec, components: doc.components }, getPart) : null),
    [on, doc.spec, doc.components, getPart],
  );
  const [inputs, setInputs] = useState<SimInputs | null>(null);
  const [state, setState] = useState<SimState | null>(null);
  const inputsRef = useRef<SimInputs | null>(null);
  const stateRef = useRef<SimState | null>(null);
  const frame = useRef<SimFrame | null>(null);
  const sig = useRef("");
  const [sound, setSound] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const lastBeep = useRef(new Map<string, number>());
  const words = useRef({ t, connections, reduced, locale });
  useEffect(() => {
    words.current = { t, connections, reduced, locale };
  });

  const publish = useCallback((m: SimModel, s: SimState, force = false) => {
    const w = words.current;
    const texts = new Map<string, string>();
    for (const o of m.outputs) if (o.kind === "screen") texts.set(o.id, screenText(w.t, m, s));
    frame.current = { state: s, active: activeWires(m, s, w.connections), texts, reduced: w.reduced, rtl: w.locale === "ar" };
    const k = signature(s);
    if (force || k !== sig.current) {
      sig.current = k;
      setState(s);
    }
  }, []);

  // Start / stop.
  useEffect(() => {
    if (!model) {
      inputsRef.current = null;
      stateRef.current = null;
      frame.current = null;
      sig.current = "";
      setInputs(null);
      setState(null);
      return;
    }
    const i = initialInputs(model);
    const s = initialState(model, i);
    inputsRef.current = i;
    stateRef.current = s;
    setInputs(i);
    publish(model, s, true);
  }, [model, publish]);

  // 20 Hz clock while on (paused in a hidden tab).
  useEffect(() => {
    if (!model) return;
    // Real time drives the clock (a busy main thread fires the timer late): whole 50 ms
    // steps, at most 0.5 s caught up at once, so the result stays the same step sequence.
    let last = performance.now();
    let owed = 0;
    const id = window.setInterval(() => {
      const now = performance.now();
      owed = Math.min(0.5, owed + (now - last) / 1000);
      last = now;
      if (document.hidden || !stateRef.current || !inputsRef.current) {
        owed = 0;
        return;
      }
      let s = stateRef.current;
      while (owed >= SIM_DT - 1e-6) {
        s = step(model, s, inputsRef.current, SIM_DT);
        owed -= SIM_DT;
      }
      stateRef.current = s;
      publish(model, s);
      // Beeps, one per beat, only with the sound turned on.
      const ctx = audio.current;
      for (const o of s.outputs) {
        if ((o.kind !== "buzzer" && o.kind !== "speaker") || !o.on || !o.beepHz) continue;
        const beat = Math.floor(s.t * o.beepHz);
        if (lastBeep.current.get(o.id) !== beat) {
          lastBeep.current.set(o.id, beat);
          if (ctx && ctx.state === "running") beep(ctx);
        }
      }
    }, SIM_DT * 1000);
    return () => window.clearInterval(id);
  }, [model, publish]);

  // A reduced-motion change re-publishes the frame.
  useEffect(() => {
    if (model && stateRef.current) publish(model, stateRef.current, true);
  }, [reduced, locale, model, publish]);

  useEffect(
    () => () => {
      void audio.current?.close().catch(() => undefined);
      audio.current = null;
    },
    [],
  );

  const update = useCallback((fn: (i: SimInputs) => SimInputs) => {
    if (!inputsRef.current) return;
    const next = fn(inputsRef.current);
    inputsRef.current = next;
    setInputs(next);
  }, []);
  const setValue = useCallback((id: string, v: number) => update((i) => ({ ...i, values: { ...i.values, [id]: v } })), [update]);
  const setThreshold = useCallback(
    (id: string, v: number) => update((i) => ({ ...i, thresholds: { ...i.thresholds, [id]: v } })),
    [update],
  );
  const press = useCallback(
    (id: string) =>
      update((i) => ({ ...i, values: { ...i.values, [id]: 1 }, presses: { ...i.presses, [id]: (i.presses[id] ?? 0) + 1 } })),
    [update],
  );
  const release = useCallback((id: string) => update((i) => ({ ...i, values: { ...i.values, [id]: 0 } })), [update]);
  const toggleSound = useCallback(() => {
    setSound((was) => {
      const next = !was;
      try {
        if (next) {
          const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (Ctor) {
            audio.current ??= new Ctor();
            void audio.current.resume();
          }
        } else void audio.current?.suspend();
      } catch {
        /* no audio: the rings still show the beeps */
      }
      return next;
    });
  }, []);

  if (!model || !inputs || !state) return null;
  return {
    model,
    inputs,
    state,
    frame,
    moving: isMoving(state),
    setValue,
    setThreshold,
    press,
    release,
    sound,
    toggleSound,
    status: statusLine(t, model, state),
  };
}

// ── The panel ───────────────────────────────────────────────────────────────

export function TryItPanel({ sim, locale, reduced }: { sim: Sim; locale: Locale; reduced: boolean }) {
  const t = useSimT();
  const { model, inputs, state } = sim;
  const hasSound = model.outputs.some((o) => o.kind === "buzzer" || o.kind === "speaker");
  const pump = model.outputs.some((o) => o.kind === "pump");
  const joints = model.controls.filter((c) => c.kind === "joint");
  const others = model.controls.filter((c) => c.kind !== "joint");
  const jointLabel = (c: SimControl) => c.name?.[locale] ?? t("control.joint", { n: String(c.n ?? 1) });
  return (
    <div
      role="group"
      aria-label={t("panelLabel")}
      dir={locale === "ar" ? "rtl" : "ltr"}
      data-testid="studio-sim-panel"
      data-outputs={outputsAttr(state)}
      data-cause={state.cause}
      className="mt-2 rounded-2xl border border-slate-900/[0.07] bg-white/95 p-3 shadow-neu-sm md:absolute md:inset-x-3 md:bottom-3 md:z-10 md:mt-0 md:max-h-[46%] md:overflow-y-auto md:backdrop-blur"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-mutedtext">{t("note")}</p>
        {hasSound && (
          <button
            type="button"
            onClick={sim.toggleSound}
            aria-pressed={sim.sound}
            aria-label={t("soundLabel")}
            data-testid="studio-sim-sound"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-panel px-3 text-xs font-semibold text-heading shadow-neu-sm"
          >
            {sim.sound ? <Volume2 className="h-4 w-4" aria-hidden /> : <VolumeX className="h-4 w-4" aria-hidden />}
            {sim.sound ? t("soundOn") : t("soundOff")}
          </button>
        )}
      </div>
      {model.outputs.length === 0 && <p className="mt-2 text-sm text-body">{t("nothing")}</p>}
      <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
        {others.map((c) => (
          <Control key={c.id} c={c} sim={sim} t={t} value={inputs.values[c.id] ?? c.initial} threshold={inputs.thresholds[c.id]} pump={pump} />
        ))}
        {joints.length > 0 && joints.length <= JOINT_SLIDERS_MAX &&
          joints.map((c) => (
            <Control
              key={c.id}
              c={c}
              sim={sim}
              t={t}
              value={inputs.values[c.id] ?? c.initial}
              threshold={undefined}
              pump={pump}
              label={jointLabel(c)}
            />
          ))}
      </div>
      {joints.length > JOINT_SLIDERS_MAX && <JointPicker joints={joints} sim={sim} t={t} label={jointLabel} values={inputs.values} />}
      {reduced && (
        <ul className="mt-2 flex flex-wrap gap-1.5" data-testid="studio-sim-chips">
          {effects(state).map((e) => (
            <li key={e.kind} className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-heading shadow-neu-inset">
              {e.kind === "servo"
                ? t("effect.servo", { angle: String(e.angle ?? 0) })
                : e.kind === "ring" && e.on
                  ? t("effect.ringOn", { colour: t(`colour.${e.colourName ?? "warm"}`) })
                  : t(`effect.${e.kind}${e.on ? "On" : "Off"}`)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** More joints than sliders fit: pick one, then one slider for it. */
function JointPicker({
  joints,
  sim,
  t,
  label,
  values,
}: {
  joints: SimControl[];
  sim: Sim;
  t: T;
  label: (c: SimControl) => string;
  values: Record<string, number>;
}) {
  const [picked, setPicked] = useState(joints[0]?.id ?? "");
  const c = joints.find((j) => j.id === picked) ?? joints[0];
  if (!c) return null;
  return (
    <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2" data-testid="studio-sim-joint-picker">
      <label className="flex min-w-0 flex-col gap-1 text-sm font-semibold text-heading">
        <span>{t("jointPick")}</span>
        <select
          value={c.id}
          onChange={(e) => setPicked(e.target.value)}
          data-testid="studio-sim-joint-select"
          className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm font-semibold text-heading"
        >
          {joints.map((j) => (
            <option key={j.id} value={j.id}>
              {label(j)}
            </option>
          ))}
        </select>
      </label>
      <Control c={c} sim={sim} t={t} value={values[c.id] ?? c.initial} threshold={undefined} pump={false} label={label(c)} />
    </div>
  );
}

function Control({
  c,
  sim,
  t,
  value,
  threshold,
  pump,
  label: labelOverride,
}: {
  c: SimControl;
  sim: Sim;
  t: T;
  value: number;
  threshold: number | undefined;
  pump: boolean;
  label?: string;
}) {
  const label = labelOverride ?? t(`control.${c.kind}`);
  const th = c.threshold;
  const thKey = c.kind === "soil" ? (pump ? "soilWater" : "soil") : c.kind;
  const thInput = th && c.kind !== "button" && c.kind !== "touch" && c.kind !== "knob" && c.kind !== "power" && (
    <label className="flex items-center gap-1.5 text-xs font-semibold text-body">
      <span>{t(`threshold.${thKey}`)}</span>
      <input
        type="number"
        inputMode="numeric"
        min={th.min}
        max={th.max}
        step={th.step}
        value={threshold ?? th.value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) sim.setThreshold(c.id, Math.max(th.min, Math.min(th.max, v)));
        }}
        data-testid={`studio-sim-threshold-${c.kind}`}
        className="min-h-11 w-16 rounded-lg border border-slate-300 bg-white px-2 text-center text-sm font-semibold text-heading"
        dir="ltr"
      />
      <span>{th.unit === "h" ? ":00" : t(`unit.${th.unit}`)}</span>
    </label>
  );

  if (c.type === "slider") {
    return (
      <div className="min-w-0 space-y-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold text-heading">{label}</span>
          <span className="text-sm font-bold tabular-nums text-heading" dir="ltr">
            {valueText(t, c, value)}
          </span>
        </div>
        <input
          type="range"
          min={c.min}
          max={c.max}
          step={c.step}
          value={value}
          aria-label={label}
          aria-valuetext={valueText(t, c, value)}
          onChange={(e) => sim.setValue(c.id, Number(e.target.value))}
          data-testid={`studio-sim-control-${c.kind}`}
          data-joint={c.n}
          className="h-11 w-full cursor-pointer"
          style={{ accentColor: accent.ink }}
        />
        {thInput}
      </div>
    );
  }
  if (c.type === "toggle") {
    const pressed = value >= 0.5;
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={pressed}
          onClick={() => sim.setValue(c.id, pressed ? 0 : 1)}
          data-testid={`studio-sim-control-${c.kind}`}
          className={cn(
            "inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors",
            pressed ? "text-white" : "bg-panel text-heading shadow-neu-sm",
          )}
          style={pressed ? { background: accent.ink } : undefined}
        >
          {label}: {pressed ? t("toggleOn") : t("toggleOff")}
        </button>
        {thInput}
      </div>
    );
  }
  return <HoldButton c={c} sim={sim} label={label} held={value >= 0.5} />;
}

function HoldButton({ c, sim, label, held }: { c: SimControl; sim: Sim; label: string; held: boolean }) {
  const down = useRef(false);
  const start = () => {
    if (down.current) return;
    down.current = true;
    sim.press(c.id);
  };
  const end = () => {
    if (!down.current) return;
    down.current = false;
    sim.release(c.id);
  };
  return (
    <button
      type="button"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        start();
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat) {
          e.preventDefault();
          start();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") end();
      }}
      onBlur={end}
      aria-pressed={held}
      data-testid={`studio-sim-hold-${c.kind}`}
      className={cn(
        "min-h-11 w-full touch-none select-none rounded-full px-4 text-sm font-semibold transition-transform sm:w-auto",
        held ? "scale-[0.97] text-white" : "bg-panel text-heading shadow-neu-sm",
      )}
      style={held ? { background: accent.ink } : undefined}
    >
      {label}
    </button>
  );
}

export function SimStatus({ sim, locale }: { sim: Sim; locale: Locale }) {
  const t = useSimT();
  return (
    <p
      role="status"
      aria-label={t("statusLabel")}
      dir={locale === "ar" ? "rtl" : "ltr"}
      data-testid="studio-sim-status"
      className="rounded-xl bg-surface px-3 py-2 text-sm font-semibold text-heading shadow-neu-inset"
    >
      {sim.status}
    </p>
  );
}
