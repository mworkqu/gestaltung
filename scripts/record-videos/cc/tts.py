# Voice-over for the CAD Champions walkthrough with Microsoft Edge neural
# voices (edge-tts, free, no key). One MP3 per script segment plus the
# sentence timings the editor uses for the captions.
#
#   python scripts/record-videos/cc/tts.py <en|ar> <outRoot>
#
# Reads scripts/record-videos/cc/script.<lang>.json. Writes
#   <outRoot>/<lang>/vo/<id>.mp3
#   <outRoot>/<lang>/vo/timings.json  {id: {duration, sentences: [{text, start, end}]}}
# `voice` and `rate` come from the script file; `say` (word -> spoken form)
# only changes what the voice reads (e.g. "Inventor" -> "إنفنتور" for the
# Arabic voice), never the captions. Needs: pip install edge-tts; ffprobe.
import asyncio
import json
import os
import re
import subprocess
import sys

import edge_tts

HERE = os.path.dirname(os.path.abspath(__file__))


def sentences(text):
    parts = re.split(r"(?<=[.!?؟])\s+", text.strip())
    return [p for p in parts if p]


def spoken(text, say):
    for k, v in say.items():
        text = re.sub(r"(?<![\w])" + re.escape(k) + r"(?![\w])", v, text)
    return text


def probe(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return float(out)


async def one(seg, spec, out_dir):
    text = seg["narration"]
    say = spec.get("say", {})
    comm = edge_tts.Communicate(spoken(text, say), spec["voice"], rate=spec.get("rate", "+0%"), boundary="SentenceBoundary")
    audio = bytearray()
    marks = []
    async for chunk in comm.stream():
        if chunk["type"] == "audio":
            audio.extend(chunk["data"])
        elif chunk["type"] == "SentenceBoundary":
            start = chunk["offset"] / 1e7
            marks.append((start, start + chunk["duration"] / 1e7))
    path = os.path.join(out_dir, f"{seg['id']}.mp3")
    with open(path, "wb") as f:
        f.write(audio)
    dur = probe(path)
    caps = sentences(text)
    if len(marks) == len(caps):
        timed = [{"text": c, "start": round(a, 3), "end": round(b, 3)} for c, (a, b) in zip(caps, marks)]
    else:  # boundaries differ from our split: share the time by length
        total = sum(len(c) for c in caps) or 1
        t, timed = 0.0, []
        for c in caps:
            d = dur * len(c) / total
            timed.append({"text": c, "start": round(t, 3), "end": round(t + d, 3)})
            t += d
    print(f"{seg['id']}: {dur:.2f} s, {len(caps)} sentence(s){'' if len(marks) == len(caps) else ' (timed by length)'}")
    return seg["id"], {"duration": dur, "sentences": timed}


async def main():
    if len(sys.argv) < 3:
        print("Usage: python scripts/record-videos/cc/tts.py <en|ar> <outRoot>")
        sys.exit(1)
    lang, root = sys.argv[1], sys.argv[2]
    with open(os.path.join(HERE, f"script.{lang}.json"), encoding="utf8") as f:
        spec = json.load(f)
    out_dir = os.path.join(root, lang, "vo")
    os.makedirs(out_dir, exist_ok=True)
    only = set(sys.argv[3].split(",")) if len(sys.argv) > 3 else None
    path = os.path.join(out_dir, "timings.json")
    timings = {}
    if only and os.path.exists(path):
        with open(path, encoding="utf8") as f:
            timings = json.load(f)
    for seg in spec["segments"]:
        if only and seg["id"] not in only:
            continue
        k, v = await one(seg, spec, out_dir)
        timings[k] = v
    with open(path, "w", encoding="utf8") as f:
        json.dump(timings, f, ensure_ascii=False, indent=2)
    total = sum(v["duration"] for v in timings.values())
    print(f"{lang}: {len(timings)} segments, {total:.1f} s of narration ({spec['voice']})")


asyncio.run(main())
