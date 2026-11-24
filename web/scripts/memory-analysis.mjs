/* global process, console, URL */
// T-6.7: the pass rule of the memory session (ADR-0043), separate from the browser part so that the
// samples of a finished run can be judged again: `node scripts/memory-analysis.mjs run.json`.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DEFAULT_REFERENCE = fileURLToPath(new URL('../../reports/artifacts/T-6.9/playwright2_path_closed_20min.json', import.meta.url));

export const ZOOM_PERIOD_S = 50; // poseAt in memory-session.mjs
export const WARMUP_S = 60;
export const PERIOD_S = 60; // the early and the last period of the rule
export const SHARD_MB = 0.06; // upper bound of the heap cost of one shard (ADR-0043)
// thresholds of rule 1 (ADR-0043): the median change in per cent and the fitted slope in MB per minute
// `warmup`: seconds before the metric is judged. The renderer process needs 180 s: its private memory
// climbs for about three minutes while the first tiles, shards and GPU resources are touched (20-minute
// run, ADR-0043); after that it grows by 3 MB/min on average and slowing down.
const LIMITS = {
  heapAdj: { pct: 5, slope: 0.5, warmup: 60 },
  external: { pct: 25, slope: 0.5, warmup: 60 },
  // ADR-0044 (b): information only; it fails only above a ceiling of 250 MB per hour (4.2 MB/min fitted after
  // warm-up). The figure includes the automation driver's network agent (no pct limit any more).
  renderer: { pct: Infinity, slope: 250 / 60, warmup: 180 },
};
// ADR-0044 (a): the renderer-process rule without the driver (memory-nodriver.mjs)
export const NODRIVER = { minDurationS: 20 * 60, slopeFromS: 20 * 60, maxSlopeMBPerMin: 1, framesTolerance: 0.25, minSlopeSamples: 3 };
const MAX_PROGRAMS = 8; // the app's shader programs: 6 to 7 observed, a program per tile would exceed it at once
const ORPHAN_SAMPLE_SHARE = 0.05; // a transient geometry (one sample in 42) is allowed, a persistent orphan is not

/** Judge the samples of one run. */
export function analyse(samples, durationS, SAMPLE_S, SHARD_MB_USED = SHARD_MB) {
  const median = (a) => {
    const s = [...a].sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  /** Least-squares slope of y against t (seconds), in units per minute. */
  const slopePerMin = (pts) => {
    const n = pts.length;
    const mt = pts.reduce((a, p) => a + p.t, 0) / n;
    const my = pts.reduce((a, p) => a + p.y, 0) / n;
    let num = 0;
    let den = 0;
    for (const p of pts) {
      num += (p.t - mt) * (p.y - my);
      den += (p.t - mt) ** 2;
    }
    return (60 * num) / den;
  };
  const inRange = (lo, hi) => samples.filter((s) => s.t > lo && s.t <= hi);
  const last = inRange(durationS - PERIOD_S, durationS);
  const after = inRange(WARMUP_S, durationS);
  const metric = (key, lim) => {
    const w = lim.warmup ?? WARMUP_S;
    const e = median(inRange(w, w + PERIOD_S).map((s) => s[key]));
    const l = median(last.map((s) => s[key]));
    const slope = slopePerMin(inRange(w, durationS).map((s) => ({ t: s.t, y: s[key] })));
    const changePct = (100 * (l - e)) / e;
    return {
      earlyMedianMB: e,
      lastMedianMB: l,
      changeMB: l - e,
      changePct,
      slopeMBPerMin: slope,
      limitPct: lim.pct,
      limitSlopeMBPerMin: lim.slope,
      pass: changePct <= lim.pct && slope <= lim.slope,
    };
  };
  const widths = samples.map((s) => s.widthM);
  const bands = [0, 300, 600, 1500, 3000, 3800, Infinity];
  const widthBands = {};
  for (let b = 0; b + 1 < bands.length; b++) {
    widthBands[`${bands[b]}-${bands[b + 1]} m`] = widths.filter((w) => w > bands[b] && w <= bands[b + 1]).length;
  }
  const maxGeomsPerTile = Math.max(...samples.map((s) => s.maxGeomsPerTile));
  const limit = samples[0].cacheLimit;
  const maxWanted = Math.max(...samples.map((s) => s.peakWanted ?? 0));
  const maxHold = Math.max(limit, maxWanted);
  const orphanGeom = samples.map((s) => s.geometries - s.tileGeometries);
  const orphanTex = samples.map((s) => s.textures - s.tileTextures);
  const analysis = {
    rule: 'ADR-0043, amended by ADR-0044 (b)',
    sampleS: SAMPLE_S,
    zoomPeriodS: ZOOM_PERIOD_S,
    distinctZoomPhasesSampled: new Set(samples.map((s) => s.phaseS)).size,
    sampledWidthMinM: Math.min(...widths),
    sampledWidthMaxM: Math.max(...widths),
    sampledWidthBands: widthBands,
    heapAdjusted: metric('heapAdjMB', LIMITS.heapAdj),
    heapRaw: metric('heapUsedMB', { pct: Infinity, slope: Infinity }),
    external: metric('externalMB', LIMITS.external),
    rendererProcess: {
      ...metric('rendererMB', LIMITS.renderer),
      informationOnly: "includes the driver's network agent (ADR-0044); fails only above the ceiling limitSlopeMBPerMin",
    },
    gpuProcess: metric('gpuProcessMB', { pct: Infinity, slope: Infinity }),
    shardMBAssumed: SHARD_MB_USED,
    shardsLoadedFirstLast: [samples[0].shardsLoaded, samples.at(-1).shardsLoaded],
    maxGeometries: Math.max(...samples.map((s) => s.geometries)),
    maxTextures: Math.max(...samples.map((s) => s.textures)),
    maxGeomsPerTile,
    maxTilesInScene: Math.max(...samples.map((s) => s.tilesInScene)),
    cacheLimit: limit,
    maxWantedTiles: maxWanted,
    geometryBound: maxHold * maxGeomsPerTile + 1,
    orphanGeometriesMax: Math.max(...orphanGeom),
    orphanTexturesMax: Math.max(...orphanTex),
    programsAfterWarmup: [Math.min(...after.map((s) => s.programs)), Math.max(...after.map((s) => s.programs))],
    domNodesAfterWarmup: [Math.min(...after.map((s) => s.domNodes)), Math.max(...after.map((s) => s.domNodes))],
    browserNodesAfterWarmup: [Math.min(...after.map((s) => s.nodes)), Math.max(...after.map((s) => s.nodes))],
  };
  analysis.coverageOk = analysis.sampledWidthMinM <= 300 && analysis.sampledWidthMaxM >= 3800;
  const orphanShare = (a) => a.filter((x) => x > 0).length / a.length;
  analysis.orphanGeometrySampleShare = orphanShare(orphanGeom);
  analysis.geometriesWithinCache =
    analysis.maxGeometries <= analysis.geometryBound && analysis.orphanGeometriesMax <= 1 && analysis.orphanGeometrySampleShare <= ORPHAN_SAMPLE_SHARE;
  analysis.texturesWithinCache = analysis.orphanTexturesMax <= 0;
  analysis.tilesWithinLimit = analysis.maxTilesInScene <= maxHold;
  analysis.domConstant = analysis.domNodesAfterWarmup[0] === analysis.domNodesAfterWarmup[1];
  analysis.programsConstant = analysis.programsAfterWarmup[1] <= MAX_PROGRAMS && new Set(last.map((s) => s.programs)).size === 1;
  analysis.pass =
    durationS >= WARMUP_S + 2 * PERIOD_S &&
    analysis.coverageOk &&
    analysis.heapAdjusted.pass &&
    analysis.external.pass &&
    analysis.rendererProcess.pass && // the ceiling only (ADR-0044 b)
    analysis.geometriesWithinCache &&
    analysis.texturesWithinCache &&
    analysis.tilesWithinLimit &&
    analysis.domConstant &&
    analysis.programsConstant;
  return analysis;
}

/** Least-squares slope of key against t (s) over the given samples, in units per minute; null under 3 samples. */
function slopeOf(pts, key) {
  if (pts.length < NODRIVER.minSlopeSamples) return null;
  const mt = pts.reduce((a, p) => a + p.t, 0) / pts.length;
  const my = pts.reduce((a, p) => a + p[key], 0) / pts.length;
  let num = 0;
  let den = 0;
  for (const p of pts) {
    num += (p.t - mt) * (p[key] - my);
    den += (p.t - mt) ** 2;
  }
  return (60 * num) / den;
}

/**
 * ADR-0044 (a): judge a run made without the automation driver. Valid only if every sample is `visible`, the
 * run lasts at least 20 minutes and the frame count is within 25 % of the reference (frames per second of the
 * reference run times this run's length). Passes if the renderer slope from minute 20 is at most 1 MB/min.
 * `reference` is { frames, t } (the last sample of the reference run). A slope needs 3 samples after minute 20:
 * with fewer there is no measurement and the run fails.
 */
export function judgeNoDriver(samples, durationS, reference) {
  const reasons = [];
  const hidden = samples.filter((s) => s.visibility !== 'visible').length;
  if (hidden > 0) reasons.push(`${hidden} of ${samples.length} samples not visible (or visibility missing)`);
  if (durationS < NODRIVER.minDurationS) reasons.push(`run lasts ${durationS} s, under ${NODRIVER.minDurationS} s`);
  const lastS = samples.at(-1);
  const framesRun = lastS?.frames;
  const framesExpected = framesRun === undefined ? undefined : (reference.frames * lastS.t) / reference.t;
  const framesRatio = framesRun === undefined ? null : framesRun / framesExpected;
  if (framesRatio === null) reasons.push('frame counts missing');
  else if (Math.abs(framesRatio - 1) > NODRIVER.framesTolerance) reasons.push(`frames ${framesRun} against ${framesExpected.toFixed(0)} expected (ratio ${framesRatio.toFixed(3)}, tolerance 25 %)`);
  const valid = reasons.length === 0;
  const slope = slopeOf(samples.filter((s) => s.t > NODRIVER.slopeFromS), 'rendererMB');
  if (slope === null) reasons.push('fewer than 3 samples after minute 20: slope cannot be fitted');
  const slopeOk = slope !== null && slope <= NODRIVER.maxSlopeMBPerMin;
  if (slope !== null && !slopeOk) reasons.push(`renderer slope ${slope.toFixed(2)} MB/min above ${NODRIVER.maxSlopeMBPerMin}`);
  return {
    rule: 'ADR-0044 (a)',
    valid,
    pass: valid && slopeOk,
    reasons,
    rendererSlopeFromMinute20MBPerMin: slope,
    limitSlopeMBPerMin: NODRIVER.maxSlopeMBPerMin,
    framesRun,
    framesExpected,
    framesRatio,
    framesToleranceRatio: NODRIVER.framesTolerance,
    hiddenSamples: hidden,
  };
}

if (process.argv[1] && process.argv[1].endsWith('memory-analysis.mjs')) {
  const r = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  if (process.argv.includes('--nodriver')) {
    const i = process.argv.indexOf('--reference');
    const ref = JSON.parse(readFileSync(i >= 0 ? process.argv[i + 1] : DEFAULT_REFERENCE, 'utf8'));
    const j = judgeNoDriver(r.samples, r.durationS, { frames: ref.samples.at(-1).frames, t: ref.samples.at(-1).t });
    console.log(JSON.stringify(j, null, 2));
    process.exit(j.pass ? 0 : 1);
  }
  const a = analyse(r.samples, r.durationS, r.sampleS);
  console.log(JSON.stringify(a, null, 2));
  process.exit(a.pass ? 0 : 1);
}
