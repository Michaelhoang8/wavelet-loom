function dimensions(size, levels) {
  if (
    ![32, 64, 128, 256].includes(size) ||
    !Number.isInteger(levels) ||
    levels < 1 ||
    levels > Math.log2(size)
  )
    throw Error(
      "Use a 32, 64, 128, or 256 square image and valid decomposition depth.",
    );
}
export function transform(values, size, levels, inverse = false) {
  dimensions(size, levels);
  if (
    !Array.isArray(values) ||
    values.length !== size * size ||
    values.some((x) => typeof x !== "number" || !Number.isFinite(x))
  )
    throw Error("Invalid finite image/coefficient array.");
  const a = [...values],
    temp = Array(size * size);
  const spans = inverse
    ? Array.from({ length: levels }, (_, i) => size / 2 ** (levels - 1 - i))
    : Array.from({ length: levels }, (_, i) => size / 2 ** i);
  for (const span of spans) {
    const half = span / 2;
    for (let y = 0; y < half; y++)
      for (let x = 0; x < half; x++) {
        const spatial = [
          2 * y * size + 2 * x,
          2 * y * size + 2 * x + 1,
          (2 * y + 1) * size + 2 * x,
          (2 * y + 1) * size + 2 * x + 1,
        ];
        const spectral = [
          y * size + x,
          y * size + x + half,
          (y + half) * size + x,
          (y + half) * size + x + half,
        ];
        const source = inverse ? spectral : spatial,
          target = inverse ? spatial : spectral;
        const [p, q, r, s] = source.map((i) => a[i]);
        const transformed = [
          (p + q + r + s) / 2,
          (p - q + r - s) / 2,
          (p + q - r - s) / 2,
          (p - q - r + s) / 2,
        ];
        target.forEach((i, j) => (temp[i] = transformed[j]));
      }
    for (let y = 0; y < span; y++)
      for (let x = 0; x < span; x++) a[y * size + x] = temp[y * size + x];
  }
  return a;
}
export function decode(payload) {
  if (
    !payload ||
    Object.keys(payload).sort().join(",") !==
      "coefficients,format,levels,size,step" ||
    payload.format !== "wavelet-loom-v1"
  )
    throw Error("Invalid coefficient file.");
  dimensions(payload.size, payload.levels);
  if (
    !Number.isInteger(payload.step) ||
    payload.step < 1 ||
    payload.step > 128 ||
    !Array.isArray(payload.coefficients) ||
    payload.coefficients.length > payload.size ** 2
  )
    throw Error("Invalid quantization or sparse payload.");
  const quantized = Array(payload.size ** 2).fill(0);
  let previous = -1;
  for (const pair of payload.coefficients) {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      !Number.isInteger(pair[0]) ||
      pair[0] <= previous ||
      pair[0] >= quantized.length ||
      !Number.isInteger(pair[1]) ||
      pair[1] === 0 ||
      Math.abs(pair[1]) > Math.ceil((255 * payload.size) / payload.step)
    )
      throw Error(
        "Coefficients must be sorted unique index/nonzero-integer pairs within bounds.",
      );
    previous = pair[0];
    quantized[pair[0]] = pair[1] * payload.step;
  }
  const raw = transform(quantized, payload.size, payload.levels, true),
    pixels = raw.map((x) => Math.max(0, Math.min(255, Math.round(x))));
  return {
    payload: structuredClone(payload),
    quantized,
    raw,
    pixels,
    clipped: raw.filter((x) => x < -0.5 || x > 255.5).length,
  };
}
export function encode(model) {
  if (
    !model ||
    Object.keys(model).sort().join(",") !== "keep,levels,pixels,size,step"
  )
    throw Error("Supply size, pixels, levels, keep, and step.");
  dimensions(model.size, model.levels);
  if (
    !Array.isArray(model.pixels) ||
    model.pixels.length !== model.size ** 2 ||
    model.pixels.some((x) => !Number.isInteger(x) || x < 0 || x > 255) ||
    !Number.isInteger(model.keep) ||
    model.keep < 0 ||
    model.keep > 100 ||
    !Number.isInteger(model.step) ||
    model.step < 1 ||
    model.step > 128
  )
    throw Error(
      "Use byte pixels, integer detail percentage 0–100, and quantization step 1–128.",
    );
  const coefficients = transform(model.pixels, model.size, model.levels),
    approxSize = model.size / 2 ** model.levels,
    detail = [];
  for (let i = 0; i < coefficients.length; i++)
    if (
      Math.floor(i / model.size) >= approxSize ||
      i % model.size >= approxSize
    )
      detail.push(i);
  detail.sort(
    (a, b) => Math.abs(coefficients[b]) - Math.abs(coefficients[a]) || a - b,
  );
  const retained = new Set(
      detail.slice(0, Math.floor((detail.length * model.keep) / 100)),
    ),
    pairs = [];
  for (let i = 0; i < coefficients.length; i++) {
    if (
      (Math.floor(i / model.size) < approxSize &&
        i % model.size < approxSize) ||
      retained.has(i)
    ) {
      const value = Math.round(coefficients[i] / model.step);
      if (value) pairs.push([i, value]);
    }
  }
  const payload = {
      format: "wavelet-loom-v1",
      size: model.size,
      levels: model.levels,
      step: model.step,
      coefficients: pairs,
    },
    decoded = decode(payload),
    n = coefficients.length;
  const rawSSE = model.pixels.reduce(
      (sum, x, i) => sum + (x - decoded.raw[i]) ** 2,
      0,
    ),
    coefficientSSE = coefficients.reduce(
      (sum, x, i) => sum + (x - decoded.quantized[i]) ** 2,
      0,
    ),
    mse =
      model.pixels.reduce(
        (sum, x, i) => sum + (x - decoded.pixels[i]) ** 2,
        0,
      ) / n;
  return {
    format: "wavelet-loom-evidence-v1",
    model: structuredClone(model),
    coefficients,
    ...decoded,
    metrics: {
      nonzero: pairs.length,
      total: n,
      selectedDetails: retained.size,
      detailTotal: detail.length,
      approximationCount: approxSize ** 2,
      mse,
      psnr: mse === 0 ? null : 10 * Math.log10(255 ** 2 / mse),
      rawSSE,
      coefficientSSE,
      jsonBytes: new TextEncoder().encode(JSON.stringify(payload)).length,
    },
  };
}
export function example() {
  const size = 128,
    pixels = Array.from({ length: size * size }, (_, i) => {
      const x = i % size,
        y = Math.floor(i / size);
      let v = 30 + x * 0.8 + y * 0.35;
      if ((x - 82) ** 2 + (y - 42) ** 2 < 25 ** 2) v = 220;
      if (x > 15 && x < 55 && y > 55 && y < 108)
        v = 65 + ((x + y) % 10 < 5 ? 90 : 0);
      v += 10 * Math.sin(x * 0.6) * Math.cos(y * 0.3);
      return Math.max(0, Math.min(255, Math.round(v)));
    });
  return { size, pixels, levels: 4, keep: 15, step: 4 };
}
