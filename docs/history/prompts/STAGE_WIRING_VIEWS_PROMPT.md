# STAGE — Wiring in 4 views + linked to the code (P5-17)

Owner idea (2026-10-11): "I like the schematic, but it's not only the schematic. Show it in several ways: the wiring diagram, the schematic… Also show the real 3D components with the wires on them, so people see which pin goes where (e.g. Arduino pin 2 → LED). Then link it to the software."

## One rule: one source of truth
Everything comes from the existing netlist (lib/studio/netlist.ts). Every view and the code read the same Connection[] (lib/studio/connections.ts), so they can never disagree. Wire colours deterministic: red = 5V/3V3/VIN, black = GND, signals from a fixed palette (yellow, blue, green, orange, white, purple), same colour for a net in every view.

## The Wiring step: 4 tabs, one button
Tabs (in this order, "Wiring" opens first, the choice is remembered):
1. Wiring (Fritzing-style): flat drawings of the real boards (Uno, ESP32 DevKit, sensors, OLED, battery holder…) with every pin labelled, joined by smooth coloured wires (curves, no crossings over labels where avoidable), and a breadboard when there's a resistor or shared rail. SVG from library data: each part gets a drawing2d (outline, header rows, pin positions at 2.54 mm pitch, label side). Same zoom, pan and fit as W5.
2. 3D: the 3D component models from the library laid out on a mat/breadboard, with 3D wires (TubeGeometry along a sagging spline) from the exact pin to the exact pin. Each library part gets pins3d. Hover or tap a wire → it glows, the rest dims, label "Arduino D2 → LED + (yellow)". "Take it apart" style toggle: lift the parts apart to see under-wiring. Lazy-loaded; same lighting and finishes as the enclosure viewer.
3. Schematic: the existing SVG, unchanged except it uses the shared ids and colours.
4. Pin list: a clean table (board pin | goes to | part pin | wire colour swatch | note), printable and "Copy". The checklist people tick while wiring (tick state saved on the project).
Cross-highlight everywhere: selecting a connection in any tab highlights it in all the others (selectedConnectionId), switching tabs keeps the selection.
Build guide (3D and Wiring tabs): "Wire it step by step": ground first, then power, then each signal. "Wire 3 of 8: yellow from D2 to LED +", Next/Back, the current wire animates in.

## Link to the code (Code step)
- Generated code gets its pin constants from the netlist, each with a comment matching the views: `const int LED_PIN = 2; // yellow wire → LED + (c1)`
- Code panel: hover or tap a pin constant (or any line that uses it) → a small preview of that wire (mini 3D or Wiring snippet), and "Show in wiring" jumps to the Wiring step with it highlighted. In the Wiring step each connection has "Show in code" → Code step scrolled to the lines that use it, highlighted.
- If the client swaps a part or a pin, the code regenerates the pin block only (don't silently change their own edits; show "Pins updated" with a diff).
- Try it in a simulator (free): "Download for Wokwi" = zip with diagram.json (Wokwi format, from the same netlist, Uno or ESP32 parts) + sketch.ino, and a one-line guide "Open wokwi.com → new project → upload these 2 files". Only for parts Wokwi supports; hide the button otherwise. Don't call any Wokwi API.

## Owner UX rules
Still one button on the step ("Draw my wiring" → then "Next: the code"). Tabs are views, not steps. Colourful, big labels, nothing technical in the client's way. Netlist ids and rule-check details only in Engineer view. Mobile: tabs = segmented control; 3D full width; pin list = cards.

## Credits
Unchanged: all 4 views + the code link are included. Viewing views never costs credits.

## Tests and acceptance
- Unit: one netlist → all 4 views + code pin block agree (same pins, colours, ids) for 3 fixtures: Plant Waterer (ESP32 or Uno + soil sensor + pump via MOSFET/relay + LED + USB power), desk lamp, cat feeder.
- Playwright: select D2 in Pin list → highlighted in Wiring, 3D and Schematic; "Show in code" lands on LED_PIN; code hover shows the wire.
- Wokwi zip opens with the same wiring (check diagram.json against the schema).
- 3D wiring: 60 fps on a normal laptop with 8 parts / 20 wires; Studio first-load JS unchanged.
- EN + AR at 375 px and 1366 px; reduced motion respected (no wire animation).
