"""Measure wall time and peak resident memory of one pipeline step (T-6.1).

Usage: ``python -m milano_iso.measure --step NAME --extent EXTENT [--out FILE] -- -m module args``

Runs ``python <args>`` as a child process (same interpreter), forwards its output, and records
seconds and peak memory in a JSON list (default ``reports/artifacts/T-6.1/measurements.json``),
replacing an earlier entry with the same (step, extent). Peak memory is the child's peak working
set of the process and its descendants (Windows, ``GetProcessMemoryInfo``; the largest single
process, not a sum) or ``ru_maxrss`` of the largest child (Linux). A step reports row counts by calling
:func:`report_counts`, which prints one ``MEASURE_COUNTS {json}`` line that this wrapper collects.
Standard library only. The numbers are measurements, not deterministic outputs.
"""

import argparse
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

PREFIX = "MEASURE_COUNTS "
ENV_FLAG = "MILANO_ISO_MEASURE"
DEFAULT_OUT = (
    Path(__file__).resolve().parents[2] / "reports" / "artifacts" / "T-6.1" / "measurements.json"
)


def report_counts(**counts) -> None:
    """Print the row/feature counts of this step for the measuring wrapper (only under it)."""
    if not os.environ.get(ENV_FLAG):
        return
    print(PREFIX + json.dumps(counts, sort_keys=True), flush=True)


class _WinTree:
    """Peak working set over a process and all its descendants (Windows).

    A venv ``python.exe`` is a launcher that starts the real interpreter as a child, so the
    process we start is not the one that holds the memory. Handles are kept open once a
    descendant is seen, so its ``PeakWorkingSetSize`` stays readable after it has exited.
    """

    def __init__(self, root_pid: int):
        import ctypes
        from ctypes import wintypes

        self.ct, self.wt = ctypes, wintypes
        self.root = root_pid
        self.handles: dict[int, int] = {}
        k32 = ctypes.windll.kernel32
        k32.OpenProcess.restype = wintypes.HANDLE
        k32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        k32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
        k32.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
        k32.Process32First.argtypes = [wintypes.HANDLE, ctypes.c_void_p]
        k32.Process32Next.argtypes = [wintypes.HANDLE, ctypes.c_void_p]
        k32.CloseHandle.argtypes = [wintypes.HANDLE]
        self.k32 = k32

        class Entry(ctypes.Structure):
            _fields_ = [
                ("dwSize", wintypes.DWORD),
                ("cntUsage", wintypes.DWORD),
                ("th32ProcessID", wintypes.DWORD),
                ("th32DefaultHeapID", ctypes.c_size_t),
                ("th32ModuleID", wintypes.DWORD),
                ("cntThreads", wintypes.DWORD),
                ("th32ParentProcessID", wintypes.DWORD),
                ("pcPriClassBase", ctypes.c_long),
                ("dwFlags", wintypes.DWORD),
                ("szExeFile", ctypes.c_char * 260),
            ]

        class Counters(ctypes.Structure):
            _fields_ = [
                ("cb", wintypes.DWORD),
                ("PageFaultCount", wintypes.DWORD),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t),
            ]

        self.Entry, self.Counters = Entry, Counters
        ctypes.windll.psapi.GetProcessMemoryInfo.argtypes = [
            wintypes.HANDLE,
            ctypes.POINTER(Counters),
            wintypes.DWORD,
        ]

    def _descendants(self) -> set[int]:
        ct = self.ct
        snap = self.k32.CreateToolhelp32Snapshot(0x2, 0)  # TH32CS_SNAPPROCESS
        parent: dict[int, int] = {}
        e = self.Entry()
        e.dwSize = ct.sizeof(e)
        ok = self.k32.Process32First(snap, ct.byref(e))
        while ok:
            parent[e.th32ProcessID] = e.th32ParentProcessID
            ok = self.k32.Process32Next(snap, ct.byref(e))
        self.k32.CloseHandle(snap)
        found = {self.root}
        grew = True
        while grew:
            grew = False
            for pid, ppid in parent.items():
                if ppid in found and pid not in found:
                    found.add(pid)
                    grew = True
        return found

    def peak(self) -> int:
        """Largest PeakWorkingSetSize (bytes) of any process of the tree seen so far."""
        ct = self.ct
        for pid in self._descendants():
            if pid not in self.handles:
                h = self.k32.OpenProcess(0x1000 | 0x0400, False, pid)  # LIMITED_INFO | QUERY
                if not h:
                    h = self.k32.OpenProcess(0x1000, False, pid)
                if h:
                    self.handles[pid] = h
        best = 0
        for h in self.handles.values():
            c = self.Counters()
            c.cb = ct.sizeof(c)
            if ct.windll.psapi.GetProcessMemoryInfo(h, ct.byref(c), c.cb):
                best = max(best, int(c.PeakWorkingSetSize))
        return best

    def close(self) -> None:
        for h in self.handles.values():
            self.k32.CloseHandle(h)
        self.handles.clear()


def run_step(args: list[str]) -> tuple[int, float, int, dict]:
    """Run ``python *args``; return (returncode, seconds, peak bytes, counts)."""
    t0 = time.perf_counter()
    proc = subprocess.Popen(
        [sys.executable, *args],
        stdout=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        bufsize=1,
        env={**os.environ, ENV_FLAG: "1"},
    )
    peak = 0
    counts: dict = {}
    stop = threading.Event()
    tree = _WinTree(proc.pid) if sys.platform == "win32" else None

    def poll():
        nonlocal peak
        while not stop.is_set():
            if tree is not None:
                peak = max(peak, tree.peak())
            stop.wait(0.2)

    th = threading.Thread(target=poll, daemon=True)
    th.start()
    assert proc.stdout is not None
    for line in proc.stdout:
        if line.startswith(PREFIX):
            counts.update(json.loads(line[len(PREFIX) :]))
        else:
            sys.stdout.write(line)
            sys.stdout.flush()
    rc = proc.wait()
    seconds = time.perf_counter() - t0
    stop.set()
    th.join()
    if tree is not None:
        peak = max(peak, tree.peak())
        tree.close()
    else:
        import resource

        peak = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss * 1024
    return rc, seconds, peak, counts


def record(out: Path, entry: dict) -> None:
    items = json.loads(out.read_text(encoding="utf-8")) if out.exists() else []
    items = [i for i in items if (i["step"], i["extent"]) != (entry["step"], entry["extent"])]
    items.append(entry)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(items, indent=2) + "\n", encoding="utf-8", newline="\n")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--step", required=True)
    ap.add_argument("--extent", required=True)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("command", nargs=argparse.REMAINDER)
    a = ap.parse_args(argv)
    cmd = a.command[1:] if a.command[:1] == ["--"] else a.command
    if not cmd:
        ap.error("no command given")
    rc, seconds, peak, counts = run_step(cmd)
    record(
        a.out,
        {
            "step": a.step,
            "extent": a.extent,
            "seconds": round(seconds, 1),
            "peak_mb": round(peak / 2**20, 1),
            "returncode": rc,
            "counts": counts,
        },
    )
    print(f"measure: {a.step} [{a.extent}] {seconds:.1f} s, peak {peak / 2**20:.0f} MB, rc {rc}")
    return rc


if __name__ == "__main__":
    sys.exit(main())
