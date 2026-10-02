// OpenSCAD in a Web Worker: SCAD text in, binary STL out. The OpenSCAD
// WebAssembly build (~11 MB, ~3 MB compressed) is imported from a public CDN
// on the first render — never from /public or the app bundle — and the
// browser caches it (immutable, pinned version). Each render gets a fresh
// OpenSCAD instance: the Emscripten main() cannot run twice in one instance.

type OpenScadModule = {
  createOpenSCAD: (opts: { print?: (s: string) => void; printErr?: (s: string) => void }) => Promise<{
    getInstance(): {
      callMain(args: string[]): number;
      FS: { writeFile(path: string, data: string): void; readFile(path: string): Uint8Array };
    };
  }>;
};

type Request = { id: number; scad: string; urls: string[] };
export type WorkerReply =
  | { id: number; ok: true; stl: ArrayBuffer; log: string }
  | { id: number; ok: false; error: "load" | "render"; log: string };

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<Request>) => void) | null;
  postMessage(message: WorkerReply, transfer?: Transferable[]): void;
};

let loading: Promise<OpenScadModule> | null = null;

async function load(urls: string[]): Promise<OpenScadModule> {
  let last: unknown = null;
  for (const url of urls) {
    try {
      return (await import(/* webpackIgnore: true */ url)) as OpenScadModule;
    } catch (e) {
      last = e;
    }
  }
  throw last ?? new Error("no OpenSCAD url");
}

ctx.onmessage = async (e) => {
  const { id, scad, urls } = e.data;
  const lines: string[] = [];
  const keep = (s: string) => {
    // Startup noise that is not about the model.
    if (!/Could not initialize localization/i.test(s)) lines.push(s);
  };
  let mod: OpenScadModule;
  try {
    loading ??= load(urls);
    mod = await loading;
  } catch (err) {
    loading = null;
    ctx.postMessage({ id, ok: false, error: "load", log: String((err as Error)?.message ?? err) });
    return;
  }
  try {
    const inst = (await mod.createOpenSCAD({ print: keep, printErr: keep })).getInstance();
    inst.FS.writeFile("/input.scad", scad);
    let code: number | null = null;
    try {
      code = inst.callMain(["/input.scad", "--backend=manifold", "--export-format=binstl", "-o", "/output.stl"]);
    } catch (err) {
      keep(`OpenSCAD stopped: ${String((err as Error)?.message ?? err)}`);
    }
    let bytes: Uint8Array | null = null;
    try {
      bytes = inst.FS.readFile("/output.stl");
    } catch {
      bytes = null;
    }
    if (code !== 0 || !bytes || bytes.byteLength <= 84) {
      ctx.postMessage({ id, ok: false, error: "render", log: lines.join("\n") });
      return;
    }
    const stl = bytes.slice().buffer as ArrayBuffer;
    ctx.postMessage({ id, ok: true, stl, log: lines.join("\n") }, [stl]);
  } catch (err) {
    ctx.postMessage({ id, ok: false, error: "render", log: `${lines.join("\n")}\n${String((err as Error)?.message ?? err)}` });
  }
};
