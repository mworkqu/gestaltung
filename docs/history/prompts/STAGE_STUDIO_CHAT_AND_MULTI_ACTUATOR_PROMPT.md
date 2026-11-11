# STAGE — Studio idea chat that answers + products with many motors (robot arm)

Read CLAUDE.md first (Design Studio P5-13…P5-17, W1–W8). Build only what this prompt asks.
After each part, run: typecheck, lint, `npm run test`, `node scripts/check-i18n-parity.mjs`,
the Studio e2e specs, then `npm run build`. Tell me how to test it locally. One commit per part.
No migration unless a part says so (none should be needed: the Studio doc is jsonb).

## What a user hit (live, 2026-10-13)

1. Idea step: "robotic arm" → "big robotic arm like ur10" → card "Robotic Arm — sits on a desk, moves
   something, plugs into the wall, you turn a knob". Then "do you know what is ur10", "are you stupid",
   "who create you?" — every reply was the same "Done. Your card is updated."
   Cause: once a card exists, `lib/studio/ai/spec.ts` forces `forceSpec` (the model may only return a
   spec), and `components/studio/steps/IdeaStep.tsx` renders the fixed string `ideaCard.refined` for
   every assistant reply (`m.note ? t("ideaCard.refined") : m.text`). Each of those messages also cost
   a Gemini call.
2. Parts step: ONE SG90 servo for a robot arm. Causes:
   - `ProductSpec` has no count — "like a UR10" (6 joints) became the tag "moves something".
   - `PICK_SYSTEM` (lib/studio/ai/prompts.ts) says "Pick the smallest set of parts".
   - The library has only `sg90_servo` (too weak for an arm), no servo driver, and the only wall
     supply is the small `usbc_power_5v`. The 12-part cap (MAX_COMPONENTS) and the pin count of
     esp32_c3_mini would also block 6 servos. pick.ts itself already allows the same part several times.
3. The site never said a real UR10 is out of scope; it silently made a desk toy.

## Part A — the idea chat answers like a person

- Change the refine turn so the model returns `{ reply, spec? , changed[] }`:
  - `reply`: one or two plain sentences in the page locale (≤ 220 chars), always present.
  - `spec`: only when the message asks for a change; otherwise omitted and the card is untouched.
  - `changed`: short human labels of what changed ("Now solar powered", "6 joints").
  Update SPEC_SYSTEM / the response schema / validateTurn / the fake model accordingly; zod-check as today.
- Message kinds the reply must handle: a change → apply + say what changed; a question about the idea
  or a reference product (e.g. "what is UR10") → answer briefly and relate it to what we can build;
  off-topic / "who made you" → one line ("I'm Gestaltung's design assistant — I help turn your idea into
  parts, wiring and a case") and back to the idea; rude messages → calm one-liner, no lecture, card unchanged.
  Never claim to be human; never name the model provider.
- Cheap guard before any model call (pure function in lib/studio/ai/spec-guards.ts, tested): empty,
  emoji-only, or a message that is only insults/greetings → a canned bilingual reply, no AI call, no card change.
- UI: show `reply` as the assistant bubble. Show the "updated" chip only when the spec actually changed
  (deep-compare old vs new spec), listing `changed`. Remove the fixed `ideaCard.refined` for all replies.
  "Update my parts" logic stays as it is (only when the spec changed).
- Scope honesty: if the idea is far beyond a desktop kit (industrial robot, car, full-size drone, anything
  > ~60 cm or needing mains motors), the first card turn says so in `reply` and offers the small version:
  "A real UR10 is an industrial arm (1.3 m reach, 10 kg). We can build a desktop arm that moves like it,
  about 30–40 cm, with hobby servos." Put that on the card as `oneLine`. Add `spec.scaleNote` (optional,
  ≤ 140 chars) shown under the card name.
- Copy EN + AR; Arabic replies come from the model in Arabic when locale = ar.
- Tests: spec.test.ts with the fake model for each message kind; guard tests; IdeaStep unit/e2e:
  question → answer bubble, card unchanged, no "updated" chip; change → chip with the change.

## Part B — the card holds how many motors (actuators)

- ProductSpec gets optional `actuators: { kind: "servo" | "motor" | "pump" | "stepper", count: 1..8,
  load: "light" | "medium" | "heavy", role?: string }[]` (max 4 entries). Add to the schema, clampSpec
  (bad values clamped and logged, never throw), the response schema and the prompt ("If the user names a
  reference product, infer its joint/motor count, e.g. 6-axis arm → servo ×6; a gripper is one more servo").
- Card shows it as a fact line: "6 joints · servo motors" (EN) / "6 مفاصل · محركات سيرفو" (AR, Western
  digits as the site rule says). User can change the count
  from the card (stepper 1–8) and in chat ("make it 4 joints").
- Keep it generic (pumps ×2, wheels ×2 motors, pan-tilt servo ×2), not arm-only.

## Part C — parts the picker needs

New library parts (lib/studio/library/parts/*, same structure + procedural model + validatePart):
- `mg996r_servo` — metal-gear servo, 4.8–7.2 V, stall ~2.5 A, 3-pin (signal/V+/GND), standard size.
- `pca9685_servo` — 16-channel I2C PWM/servo driver: VCC 3.3–5 V logic, separate V+ terminal for servo
  power, I2C SDA/SCL, 16 three-pin outputs. Address 0x40.
- `psu_5v_5a` (wall 5 V / 5 A barrel supply) + a barrel jack/terminal if the wiring needs one.
Link store SKUs only if a confident Voltaat/DigiKey match exists (check the live parts table read-only);
otherwise leave `storeSkus` empty → "We'll source this". List what you linked in docs/STUDIO_SKU_LINKS.md.

## Part D — the picker uses the count

- PICK_SYSTEM: replace "smallest set" with "the fewest parts that make it work; when spec.actuators gives
  a count, include exactly that many of the matching actuator". Pass actuators in the prompt.
- Deterministic rules after the model (pick.ts, tested), the same way POWER_PARTS is enforced today:
  - servo count = sum of servo actuators (top up or trim the model's list). load heavy/medium → mg996r for
    those, light → sg90 (arm: base/shoulder/elbow medium-heavy, wrist/gripper light).
  - ≥ 3 servos, or more servos than free PWM pins → add `pca9685_servo` and wire servos to it.
  - total servo stall current over the supply → swap to `psu_5v_5a`; servos are powered from the supply's
    5 V rail through the PCA9685 V+, never from the board's 5V pin. Board gets power from the same supply.
  - an ESP32-C3 mini can't be the brain when the pin budget is exceeded without a driver; with the driver
    I2C is enough.
- MAX_COMPONENTS: count identical parts as ONE slot for the cap (6 servos = 1 slot) so the cap still means
  "kinds of parts". Keep the instanceId scheme (`mg996r_servo_1…`).
- The parts list shows quantity ("MG996R servo × 3") — group identical parts in the Parts step and the
  Get it made summary/estimate (quantity × price).

## Part E — wiring, power check, layout, simulation

- lib/studio/netlist.ts buildWiring: PCA9685 on I2C (SDA/SCL + 3.3 V logic), its V+ from the 5 V supply,
  each servo on channel 0…n (signal + V+ + GND). Common ground. Plain checks (plain-checks.ts) say it in
  words: "6 servos share the 5 A supply through the servo driver".
- powerBudget: count each servo's stall current; over budget → the existing blocking line.
- connections.ts / wiring drawing / 3D breadboard / pin list must handle 6–8 identical servos without
  overlapping labels (labels "Servo 1 — base", from actuator role when given). Servos stay on the mat, not
  the breadboard; the PCA9685 sits on the mat beside the board.
- Code step pin block: PCA9685 address + one `const int SERVO_BASE = 0;` per channel (Adafruit_PWMServoDriver).
- Try it (sim): one slider per servo when ≤ 6, else a joint picker + one slider.
- Enclosure / product model: "robotic arm" archetype only if one already exists; otherwise the enclosure
  step makes a base box for board + driver + supply and says the arm links are a separate design job
  ("Arm links are designed by our engineer — ask for a quote"). Don't invent arm geometry in this stage.

## Part F — tests and checks

- Fixtures: `idea=robot_arm` in the Studio e2e fixture (mocked API): "big robotic arm like ur10" →
  reply mentions the desktop version, card shows 6 joints, Parts = board + PCA9685 + 3 MG996R + 3 SG90 (or
  the rule's result) + 5 A supply, wiring passes checks, pin list has 6 servo rows, EN + AR, 375 + 1366,
  no overflow.
- Regression: plant waterer, desk lamp, cat feeder, doorbell fixtures unchanged (one pump, etc.).
- Unit tests for clampSpec actuators, pick rules, buildWiring with PCA9685, power budget, grouping.
- Real-AI check (local, no DB writes, like the P5-16 harness): run the five chat lines from the incident
  and paste the replies + picked parts into the commit message.

Owner rule reminders: no paid services; nothing written to production while testing; parts list stays free,
wiring costs a credit as today; never promise reprints.
