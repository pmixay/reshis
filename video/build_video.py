"""Собирает видео из слайдов (build/*.png) и записи сервиса (build/app_clip.webm).

Без аудио длительность сцен считается по числу слов в тексте (narration.json).
С аудио: python video/build_video.py --audio voice.m4a --timings build/timings.json
  timings.json = {"segments": [{"id": 1, "start": 0.0, "end": 11.2}, ...]} (секунды в записи голоса).
"""
import argparse
import json
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
B = HERE / "build"
FPS = 30
XF = 0.4  # длительность перехода между сценами, с


def run(cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def scene_durations(narr, timings=None):
    segs = narr["segments"]
    if timings:
        t = {s["id"]: s for s in timings["segments"]}
        # сегмент длится от своего начала до начала следующего (паузы достаются предыдущему слайду)
        starts = [t[s["id"]]["start"] for s in segs]
        ends = starts[1:] + [t[segs[-1]["id"]]["end"] + 1.0]
        seg_len = [e - s for s, e in zip(starts, ends)]
        seg_len[0] += starts[0]  # то, что до первого слова, тоже на первом слайде
    else:
        seg_len = [len(s["text"].split()) / narr["words_per_second"] + narr["pause"] for s in segs]
        seg_len[-1] += 1.0
    out = []
    for s, L in zip(segs, seg_len):
        n = len(s["scenes"])
        for sc in s["scenes"]:
            out.append((sc, L / n))
    return out


def scene_clip(scene, dur, idx, last):
    L = dur + (0 if last else XF)
    out = B / f"clip_{idx:02d}.mp4"
    common = ["-r", str(FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p"]
    if scene == "s6":
        box = json.loads((B / "frame.json").read_text())
        clip = B / "app_clip.webm"
        clip_len = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(clip)],
                                        capture_output=True, text=True).stdout)
        k = L / clip_len  # растягиваем/сжимаем запись под длительность сцены
        w, h, x, y = int(box["width"]), int(box["height"]), int(box["x"]), int(box["y"])
        flt = (f"[1:v]setpts={k:.5f}*PTS,scale={w}:{h}:flags=lanczos,fps={FPS}[v];"
               f"[0:v][v]overlay={x}:{y}:shortest=0:eof_action=repeat,format=yuv420p[o]")
        run(["ffmpeg", "-y", "-loop", "1", "-t", f"{L:.3f}", "-i", str(B / f"{scene}.png"), "-i", str(clip),
             "-filter_complex", flt, "-map", "[o]", "-t", f"{L:.3f}", *common, str(out)])
    else:
        run(["ffmpeg", "-y", "-loop", "1", "-t", f"{L:.3f}", "-i", str(B / f"{scene}.png"), *common, str(out)])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio")
    ap.add_argument("--timings")
    ap.add_argument("--out", default=str(HERE / "out" / "video.mp4"))
    args = ap.parse_args()
    narr = json.loads((HERE / "narration.json").read_text(encoding="utf-8"))
    timings = json.loads(Path(args.timings).read_text()) if args.timings else None
    plan = scene_durations(narr, timings)
    clips = [scene_clip(sc, d, i, i == len(plan) - 1) for i, (sc, d) in enumerate(plan)]

    inputs, flt, prev, t = [], [], "0:v", 0.0
    for c in clips:
        inputs += ["-i", str(c)]
    for i in range(1, len(clips)):
        t += plan[i - 1][1]
        flt.append(f"[{prev}][{i}:v]xfade=transition=fade:duration={XF}:offset={t - 0:.3f}[x{i}]")
        prev = f"x{i}"
    cmd = ["ffmpeg", "-y", *inputs]
    if args.audio:
        cmd += ["-i", args.audio]
    cmd += ["-filter_complex", ";".join(flt), "-map", f"[{prev}]"]
    if args.audio:
        cmd += ["-map", f"{len(clips)}:a", "-c:a", "aac", "-b:a", "160k"]
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", args.out]
    run(cmd)
    total = sum(d for _, d in plan)
    print(f"video: {args.out}  ({total:.1f} s)")
    for sc, d in plan:
        print(f"  {sc}: {d:.1f} s")


if __name__ == "__main__":
    main()
