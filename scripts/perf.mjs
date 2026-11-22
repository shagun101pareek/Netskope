const base = process.env.API_URL ?? "http://127.0.0.1:3011";
const total = 50;
const started = performance.now();
const samples = [];

for (let index = 0; index < total; index += 1) {
  const mark = performance.now();
  const response = await fetch(new URL("/api/v1/health", base));
  if (!response.ok) {
    throw new Error(`health returned ${response.status}`);
  }
  await response.json();
  samples.push(performance.now() - mark);
}

samples.sort((left, right) => left - right);
const percentile = (ratio) => samples[Math.min(samples.length - 1, Math.floor(ratio * samples.length))];

console.log(
  JSON.stringify(
    {
      requests: total,
      elapsedMs: Math.round(performance.now() - started),
      p50Ms: Math.round(percentile(0.5)),
      p95Ms: Math.round(percentile(0.95)),
    },
    null,
    2,
  ),
);
