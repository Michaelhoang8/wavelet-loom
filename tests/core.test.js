import test from "node:test";
import assert from "node:assert/strict";
import { transform, encode, decode, example } from "../core.js";
function near(a, b, t = 1e-9) {
  assert.ok(
    Math.abs(a - b) < t * Math.max(1, Math.abs(a), Math.abs(b)),
    `${a} != ${b}`,
  );
}
test("orthonormal transforms round-trip all dimensions and depths", () => {
  let seed = 9;
  for (const size of [32, 64, 128, 256]) {
    const a = Array.from({ length: size * size }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % 256;
    });
    for (let levels = 1; levels <= Math.log2(size); levels++) {
      const b = transform(a, size, levels),
        r = transform(b, size, levels, true);
      a.forEach((x, i) => near(x, r[i]));
      near(
        a.reduce((s, x) => s + x * x, 0),
        b.reduce((s, x) => s + x * x, 0),
      );
    }
  }
});
test("single-level block coefficients agree with direct 2x2 basis", () => {
  const size = 32,
    a = Array.from({ length: size * size }, (_, i) => i % 256),
    b = transform(a, size, 1);
  for (let y = 0; y < size; y += 2)
    for (let x = 0; x < size; x += 2) {
      const [p, q, r, s] = [
          a[y * size + x],
          a[y * size + x + 1],
          a[(y + 1) * size + x],
          a[(y + 1) * size + x + 1],
        ],
        i = (y / 2) * size + x / 2;
      near(b[i], (p + q + r + s) / 2);
      near(b[i + 16], (p - q + r - s) / 2);
      near(b[i + 16 * size], (p + q - r - s) / 2);
      near(b[i + 16 * size + 16], (p - q - r + s) / 2);
    }
});
test("constant image retains approximation and reconstructs exactly at step one", () => {
  const m = {
      size: 32,
      pixels: Array(1024).fill(123),
      levels: 5,
      keep: 0,
      step: 1,
    },
    r = encode(m);
  assert.equal(r.metrics.nonzero, 1);
  assert.equal(r.metrics.mse, 0);
  assert.equal(r.metrics.psnr, null);
  assert.deepEqual(r.pixels, m.pixels);
});
test("quantized sparse files decode identically and Parseval accounts for error", () => {
  const m = example();
  for (const keep of [0, 1, 15, 50, 100])
    for (const step of [1, 4, 128]) {
      const r = encode({ ...m, keep, step }),
        d = decode(JSON.parse(JSON.stringify(r.payload)));
      assert.deepEqual(d.pixels, r.pixels);
      near(r.metrics.rawSSE, r.metrics.coefficientSSE, 1e-8);
      assert.equal(
        r.metrics.selectedDetails,
        Math.floor((r.metrics.detailTotal * keep) / 100),
      );
      assert.equal(
        r.metrics.jsonBytes,
        new TextEncoder().encode(JSON.stringify(r.payload)).length,
      );
    }
});
test("all-zero payload and malicious sparse structures are handled", () => {
  const p = {
    format: "wavelet-loom-v1",
    size: 32,
    levels: 5,
    step: 1,
    coefficients: [],
  };
  assert.ok(decode(p).pixels.every((x) => x === 0));
  for (const coefficients of [
    [[0, 0]],
    [
      [0, 1],
      [0, 2],
    ],
    [
      [2, 1],
      [1, 1],
    ],
    [[-1, 1]],
    [[1024, 1]],
    [[0, 999999]],
    [[1, 0.5]],
  ])
    assert.throws(() => decode({ ...p, coefficients }));
  assert.throws(() => decode({ ...p, extra: 1 }));
  assert.throws(() => encode({ ...example(), keep: 101 }));
  assert.throws(() => transform([], 31, 1));
});
