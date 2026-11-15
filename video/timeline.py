"""Тайминг сцен видео -> build/timeline.js.

Без аргументов: длительности по числу слов в narration.json (черновик).
С файлом разметки голоса: python video/timeline.py build/timings.json
  timings.json = {"segments": [{"id": 1, "start": 0.4, "end": 11.0}, ...]} (секунды записи).
"""
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
B = HERE / "build"
FPS = 30
TAIL = 2.0  # сколько держать последний слайд после конца речи, с


def main():
    narr = json.loads((HERE / "narration.json").read_text(encoding="utf-8"))
    segs = narr["segments"]
    if len(sys.argv) > 1:
        t = {s["id"]: s for s in json.loads(Path(sys.argv[1]).read_text())["segments"]}
        starts = [t[s["id"]]["start"] for s in segs]
        starts[0] = 0.0
        ends = starts[1:] + [t[segs[-1]["id"]]["end"] + TAIL]
    else:
        lens = [len(s["text"].split()) / narr["words_per_second"] + narr["pause"] for s in segs]
        lens[0] += 0.8
        lens[-1] += TAIL
        starts, acc = [], 0.0
        for L in lens:
            starts.append(acc)
            acc += L
        ends = starts[1:] + [acc]
    scenes = []
    for s, a, b in zip(segs, starts, ends):
        n = len(s["scenes"])
        for k, sc in enumerate(s["scenes"]):
            scenes.append({"id": sc, "start": round(a + (b - a) * k / n, 3), "end": round(a + (b - a) * (k + 1) / n, 3)})
    clip_dir = B / "clip"
    if not clip_dir.exists() or not any(clip_dir.iterdir()):
        clip_dir.mkdir(parents=True, exist_ok=True)
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(B / "app_clip.webm"), "-vf",
                        f"fps={FPS},scale=1136:710:flags=lanczos", "-q:v", "3", str(clip_dir / "f_%04d.jpg")], check=True)
    tl = {"fps": FPS, "scenes": scenes, "total": scenes[-1]["end"], "clipFrames": len(list(clip_dir.glob("f_*.jpg")))}
    (B / "timeline.js").write_text("window.TIMELINE = " + json.dumps(tl, ensure_ascii=False) + ";\n", encoding="utf-8")
    print(f"timeline: {len(scenes)} сцен, {tl['total']:.1f} с, кадров записи сервиса: {tl['clipFrames']}")


if __name__ == "__main__":
    main()
