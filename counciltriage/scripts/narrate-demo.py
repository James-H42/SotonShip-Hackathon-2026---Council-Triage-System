"""Add the English voice-over to the recorded demo video (macOS `say`, voice Daniel, en-GB).

Each line reads the caption on screen, starting just after that caption appears. The caption
times were measured from the video (scene changes inside the caption bar). If a line is too long
for its slot, it is read slightly faster. The picture is copied unchanged.

    python3 scripts/narrate-demo.py docs/StreetTriage-demo-silent.mp4 docs/StreetTriage-demo.mp4
"""
import os
import subprocess
import sys
import tempfile

# (caption start in seconds, narration). The last entry is the end of the video.
LINES = [
    (0.03, "StreetTriage: Southampton street reports, triaged by local A.I. A resident, then a council officer."),
    (6.67, "Test case 1: a resident signs in to their account."),
    (12.47, "They pick the problem from the list. Their photos' GPS places the pin, and they can click the map to adjust it."),
    (21.73, "A few questions, and a short description in their own words."),
    (30.43, "Sent, with a reference number. The local A.I. triages it in the background."),
    (37.63, "Test case 2: a report that may be a repeat. A street light on Westgate Street."),
    (50.83, "The local L.L.M. compared their words with nearby reports, and found a match. The resident confirms, and adds their details."),
    (59.60, "Test case 3: the resident opens a past report, to check its details and progress."),
    (66.07, "Test case 4: the officer's queue is sorted by risk. Each issue has photos, and a full score breakdown."),
    (74.40, "Test case 5: Start processing moves the issue to the In progress section, and the resident is told."),
    (82.33, "Merged reports: several residents reported the same street light. The A.I. merged them into one incident in the queue."),
    (90.20, "Expand the incident, to see every individual report that was merged into it."),
    (95.93, "Open it: each original report is kept, with its own words, photos and date."),
    (102.23, "The resident who confirmed the duplicate added extra details. Officers see them here."),
    (107.83, "Test case 6: the map shows every report, from green, for low, to red, for critical. Filter by issue and urgency."),
    (117.93, "Test case 7: the shortest route between same-type issues. The solid line follows real roads; the dashed line is the straight line."),
    (127.80, "Booked as a work order: the crew's agenda for the day, with arrival times, and the residents are told."),
    (135.57, None),
]


def duration(path):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]))


def main(src, out):
    tmp = tempfile.mkdtemp(prefix="narrate-")
    clips = []
    for i, (t, text) in enumerate(LINES[:-1]):
        start = max(0.15, t + 0.25) if i else 0.15
        slot = LINES[i + 1][0] - start - 0.35 + (0.45 if i == 0 else 0)
        rate = 175 if i else 190
        path = os.path.join(tmp, f"{i:02d}.aiff")
        while True:
            subprocess.run(["say", "-v", "Daniel", "-r", str(rate), "-o", path, text], check=True)
            if duration(path) <= slot or rate >= 235:
                break
            rate += 10
        # The opening line runs slightly long, so the second line starts half a second later.
        clips.append((path, 7.10 if i == 1 else start))
    args = ["ffmpeg", "-y", "-v", "error", "-i", src]
    filters = []
    for i, (path, start) in enumerate(clips):
        args += ["-i", path]
        ms = int(start * 1000)
        filters.append(f"[{i + 1}:a]aresample=48000,adelay={ms}|{ms}[a{i}]")
    filters.append("".join(f"[a{i}]" for i in range(len(clips))) + f"amix=inputs={len(clips)}:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,apad[a]")
    args += ["-filter_complex", ";".join(filters), "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", "-shortest", "-movflags", "+faststart", out]
    subprocess.run(args, check=True)
    print("Wrote", out)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
