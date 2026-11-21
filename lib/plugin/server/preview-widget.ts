/**
 * The "How it will look" widget: one self-contained HTML document served as the
 * MCP Apps UI resource `ui://gestaltung360/preview`.
 *
 * Why it is a TS string and not a file in /public: the MCP server serves it as
 * a resource, and nothing about the plugin may depend on our static hosting.
 *
 * Bridge: hand-rolled JSON-RPC 2.0 over window.postMessage, as the MCP Apps
 * spec (2026-01-26) defines, plus feature-detection of ChatGPT's legacy
 * `window.openai` globals. No SDK, so there is no new dependency and no
 * guessing at an API we have not pinned.
 *
 * It renders the case proportionally from the template — NO millimetre figures
 * (see lib/plugin/preview.ts) — then the parts with their QAR prices, the list
 * of what would be sent, and two buttons that call `send_project` and
 * `list_meeting_slots` back through the host.
 *
 * Deliberately NOT here: the OpenSCAD / geometry engine. The widget's CSP
 * declares cdn.jsdelivr.net so a lazy engine can be added, but the MCP Apps
 * spec does not say whether WebAssembly is allowed inside the sandboxed
 * iframe, and a preview that silently fails is worse than an honest drawing.
 * The hand-off page remains the full preview. See docs/history/.
 */

/** Everything the widget needs is inlined; it loads nothing at render time. */
export const PREVIEW_WIDGET_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>How it will look</title>
<style>
  :root {
    --bg: #f4f7fb; --panel: #fff; --heading: #121821; --body: #39414d;
    --muted: #6b7682; --faint: #93a0ad; --cobalt: #2f5fd0; --line: #e2e8f0;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #11161d; --panel: #171e27; --heading: #f2f5f8; --body: #cbd3dc;
            --muted: #96a2ae; --faint: #717e8b; --line: #263040; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; background: var(--bg); color: var(--body);
         font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 18px; padding: 16px; max-width: 560px; margin: 0 auto; }
  h1 { font-size: 17px; margin: 0 0 2px; color: var(--heading); letter-spacing: -0.01em; }
  h2 { font-size: 12px; margin: 16px 0 6px; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; }
  p { margin: 0 0 8px; }
  .sub { color: var(--muted); margin: 0 0 12px; }
  .stage { display: flex; align-items: center; justify-content: center; height: 150px;
           background: linear-gradient(180deg, rgba(127,127,127,.06), rgba(127,127,127,.14)); border-radius: 14px; }
  ul { margin: 0; padding: 0; list-style: none; }
  li { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; border-bottom: 1px solid var(--line); }
  li:last-child { border-bottom: 0; }
  .qty { color: var(--muted); }
  .price { white-space: nowrap; color: var(--heading); font-variant-numeric: tabular-nums; }
  .sourced { color: var(--faint); font-style: italic; }
  .total { display: flex; justify-content: space-between; font-weight: 700; color: var(--heading); padding-top: 10px; }
  .sends li { display: list-item; border: 0; padding: 2px 0 2px 16px; position: relative; color: var(--body); }
  .sends li::before { content: "·"; position: absolute; left: 4px; color: var(--faint); }
  .row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
  button { font: inherit; font-weight: 600; min-height: 42px; padding: 0 16px; border-radius: 999px;
           border: 1px solid var(--line); background: var(--panel); color: var(--body); cursor: pointer; }
  button.primary { background: var(--cobalt); border-color: var(--cobalt); color: #fff; }
  button[disabled] { opacity: .55; cursor: default; }
  .note { color: var(--faint); font-size: 12px; margin-top: 12px; }
  .status { color: var(--cobalt); font-weight: 600; margin-top: 10px; }
  [dir="rtl"] .sends li { padding: 2px 16px 2px 0; }
  [dir="rtl"] .sends li::before { left: auto; right: 4px; }
</style>
</head>
<body>
<div class="card" id="card">
  <p class="sub" id="loading">Loading…</p>
</div>
<script>
(function () {
  "use strict";

  // ── the bridge ────────────────────────────────────────────────────────────
  // MCP Apps: JSON-RPC 2.0 to window.parent. ChatGPT also exposes window.openai;
  // we feature-detect rather than branch on a host name.
  var nextId = 1;
  var pending = {};

  function rpc(method, params) {
    var id = nextId++;
    try {
      window.parent.postMessage({ jsonrpc: "2.0", id: id, method: method, params: params || {} }, "*");
    } catch (e) { return Promise.reject(e); }
    return new Promise(function (resolve, reject) {
      pending[id] = { resolve: resolve, reject: reject };
      setTimeout(function () {
        if (pending[id]) { delete pending[id]; reject(new Error("timeout")); }
      }, 60000);
    });
  }

  function notify(method, params) {
    try { window.parent.postMessage({ jsonrpc: "2.0", method: method, params: params || {} }, "*"); } catch (e) {}
  }

  function callTool(name, args) {
    if (window.openai && typeof window.openai.callTool === "function") {
      return Promise.resolve(window.openai.callTool(name, args || {}));
    }
    return rpc("tools/call", { name: name, arguments: args || {} });
  }

  function say(text) {
    if (window.openai && typeof window.openai.sendFollowUpMessage === "function") {
      try { window.openai.sendFollowUpMessage({ prompt: text }); return; } catch (e) {}
    }
    notify("ui/message", { role: "user", content: { type: "text", text: text } });
  }

  function sizeChanged() {
    var h = document.documentElement.scrollHeight;
    notify("ui/notifications/size-changed", { width: document.documentElement.scrollWidth, height: h });
    if (window.openai && typeof window.openai.notifyIntrinsicHeight === "function") {
      try { window.openai.notifyIntrinsicHeight(h); } catch (e) {}
    }
  }

  // ── rendering ─────────────────────────────────────────────────────────────
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  // A proportional drawing of the case. No dimensions: the engineer models it.
  function shapeSvg(template, swatch) {
    var w = 150, h = 110, f = swatch || "#dfe5ec", stroke = "rgba(0,0,0,.28)";
    var body;
    switch (template) {
      case "puck":
        body = '<ellipse cx="75" cy="60" rx="52" ry="30" fill="' + f + '" stroke="' + stroke + '"/>' +
               '<path d="M23 60v12a52 30 0 0 0 104 0V60" fill="' + f + '" stroke="' + stroke + '"/>';
        break;
      case "pill":
        body = '<rect x="20" y="36" width="110" height="48" rx="24" fill="' + f + '" stroke="' + stroke + '"/>';
        break;
      case "soft_wedge":
        body = '<path d="M22 84h106l-10-34H40z" fill="' + f + '" stroke="' + stroke + '"/>';
        break;
      case "handheld_taper":
        body = '<path d="M52 26h46l14 62H38z" rx="10" fill="' + f + '" stroke="' + stroke + '"/>';
        break;
      case "lantern":
        body = '<path d="M46 34h58v44a29 14 0 0 1-58 0z" fill="' + f + '" stroke="' + stroke + '"/>' +
               '<rect x="66" y="18" width="18" height="12" rx="6" fill="none" stroke="' + stroke + '"/>';
        break;
      case "dome_base":
        body = '<path d="M38 74a37 37 0 0 1 74 0z" fill="' + f + '" stroke="' + stroke + '"/>' +
               '<rect x="32" y="74" width="86" height="14" rx="5" fill="' + f + '" stroke="' + stroke + '"/>';
        break;
      case "wall_plate":
        body = '<rect x="26" y="30" width="98" height="58" rx="8" fill="' + f + '" stroke="' + stroke + '"/>' +
               '<circle cx="40" cy="44" r="2.5" fill="' + stroke + '"/><circle cx="110" cy="44" r="2.5" fill="' + stroke + '"/>';
        break;
      case "stake_pod":
        body = '<rect x="40" y="22" width="70" height="44" rx="12" fill="' + f + '" stroke="' + stroke + '"/>' +
               '<path d="M72 66h6v26l-3 8-3-8z" fill="' + f + '" stroke="' + stroke + '"/>';
        break;
      default: // rounded_box
        body = '<rect x="24" y="34" width="102" height="52" rx="12" fill="' + f + '" stroke="' + stroke + '"/>' +
               '<path d="M24 48h102" stroke="' + stroke + '" opacity=".5"/>';
    }
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="190" height="140" role="img" aria-label="How it will look">' + body + "</svg>";
  }

  var data = null;
  var busy = false;

  function render() {
    if (!data) return;
    var ar = data.locale === "ar";
    document.documentElement.setAttribute("dir", ar ? "rtl" : "ltr");
    document.documentElement.setAttribute("lang", ar ? "ar" : "en");

    var t = ar
      ? { look: "كيف سيبدو", parts: "القطع", total: "إجمالي القطع", sends: "ما سيتم إرساله",
          send: "أرسل هذا المشروع", meet: "تحدث مع المهندس", sourced: "نوفّرها لك",
          sending: "جارٍ الإرسال…", sent: "تم الإرسال — افتح الرابط في المحادثة.", failed: "تعذّر الإرسال. حاول من المحادثة." }
      : { look: "How it will look", parts: "Parts", total: "Parts total", sends: "What will be sent",
          send: "Send this project", meet: "Talk to the engineer", sourced: "we source it",
          sending: "Sending…", sent: "Sent — open the link in the chat.", failed: "That did not work. Try from the chat." };

    var partsHtml = (data.parts || []).map(function (p) {
      var right = p.price ? '<span class="price">' + esc(p.price) + "</span>"
                          : '<span class="sourced">' + esc(t.sourced) + "</span>";
      return "<li><span>" + esc(p.name) + ' <span class="qty">×' + esc(p.qty) + "</span></span>" + right + "</li>";
    }).join("");

    var sendsHtml = (data.sends || []).map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("");
    var look = data.look || {};
    var looks = [look.shape, look.colour, look.finish].filter(Boolean).map(esc).join(" · ");

    document.getElementById("card").innerHTML =
      "<h1>" + esc(data.name) + "</h1>" +
      '<p class="sub">' + esc(t.look) + "</p>" +
      '<div class="stage">' + shapeSvg(look.template, look.swatch) + "</div>" +
      "<p" + (looks ? "" : ' hidden') + ' style="margin-top:10px">' + looks +
        (look.label ? " · “" + esc(look.label) + "”" : "") + "</p>" +
      (look.notes ? '<p class="note">' + esc(look.notes) + "</p>" : "") +
      "<h2>" + esc(t.parts) + "</h2><ul>" + partsHtml + "</ul>" +
      '<div class="total"><span>' + esc(t.total) + "</span><span>" + esc(data.parts_total) + "</span></div>" +
      (data.wiring_summary ? '<p class="note">' + esc(data.wiring_summary) + "</p>" : "") +
      "<h2>" + esc(t.sends) + '</h2><ul class="sends">' + sendsHtml + "</ul>" +
      '<div class="row">' +
        '<button class="primary" id="send"' + (busy ? " disabled" : "") + ">" + esc(busy ? t.sending : t.send) + "</button>" +
        '<button id="meet"' + (busy ? " disabled" : "") + ">" + esc(t.meet) + "</button>" +
      "</div>" +
      '<p class="note">' + esc(data.engineer_line) + "</p>" +
      '<p class="note">' + esc(data.company) + "</p>" +
      '<p class="status" id="status" hidden></p>';

    var status = document.getElementById("status");
    var show = function (text) { status.hidden = false; status.textContent = text; sizeChanged(); };

    // Clicking Send IS the user's explicit agreement, and the list above says
    // exactly what goes. The server re-checks the project before it stores it.
    document.getElementById("send").addEventListener("click", function () {
      if (busy || !data.build) { say(t.send); return; }
      busy = true; show(t.sending);
      callTool("send_project", { build: data.build, locale: data.locale }).then(
        function () { busy = false; show(t.sent); },
        function () { busy = false; show(t.failed); }
      );
    });

    document.getElementById("meet").addEventListener("click", function () {
      callTool("list_meeting_slots", { locale: data.locale }).catch(function () { say(t.meet); });
    });

    sizeChanged();
  }

  function take(result) {
    if (!result) return;
    var payload = result.structuredContent || result;
    if (payload && payload.name) { data = payload; render(); }
  }

  window.addEventListener("message", function (event) {
    var m = event.data;
    if (!m || m.jsonrpc !== "2.0") return;
    if (m.id && pending[m.id]) {
      var p = pending[m.id];
      delete pending[m.id];
      if (m.error) p.reject(new Error(m.error.message || "error")); else p.resolve(m.result);
      return;
    }
    if (m.method === "ui/notifications/tool-result") take(m.params);
    if (m.method === "ui/notifications/tool-input" && m.params && m.params.arguments) take(m.params.arguments);
  });

  // ChatGPT hands the result over as a global instead.
  if (window.openai && window.openai.toolOutput) take(window.openai.toolOutput);
  window.addEventListener("openai:set_globals", function () {
    if (window.openai && window.openai.toolOutput) take(window.openai.toolOutput);
  });

  notify("ui/notifications/initialized", {});
  rpc("ui/initialize", { protocolVersion: "2026-01-26" }).then(function (r) {
    if (r && r.hostContext && r.hostContext.toolInfo) take(r.hostContext.toolInfo);
  }, function () {});
})();
</script>
</body>
</html>
`;

/**
 * The resource's `_meta.ui`. cdn.jsdelivr.net is declared so a lazy geometry
 * engine can be added later without a spec change; nothing loads from it today.
 */
export const PREVIEW_UI_META = {
  ui: {
    prefersBorder: true,
    csp: {
      connectDomains: [],
      resourceDomains: ["https://cdn.jsdelivr.net"],
    },
  },
} as const;
