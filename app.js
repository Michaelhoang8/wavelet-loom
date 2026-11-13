import { example } from "./core.js";
const $ = (id) => document.getElementById(id),
  worker = new Worker("/worker.js", { type: "module" });
let model = example(),
  result,
  mode = "encode",
  sequence = 0,
  loadSequence = 0,
  ready = false,
  sourceLabel = "Generated study";
function el(tag, text) {
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
}
function message(text, error = false) {
  $("message").textContent = text;
  $("message").classList.toggle("error", error);
}
function enabled(value) {
  for (const id of ["save", "png", "evidence", "reuse"])
    $(id).disabled = !value;
}
function run() {
  ready = false;
  enabled(false);
  worker.postMessage({ id: ++sequence, model, mode });
  message(
    mode === "encode"
      ? "Transforming, selecting details, and reconstructing…"
      : "Reconstructing the coefficient file…",
  );
}
function controls() {
  const size = mode === "encode" ? model.size : result.payload.size,
    levels = mode === "encode" ? model.levels : result.payload.levels;
  $("levels").replaceChildren(
    ...Array.from({ length: Math.log2(size) }, (_, i) => {
      const o = el("option", String(i + 1));
      o.value = i + 1;
      return o;
    }),
  );
  $("levels").value = levels;
  $("step").value = mode === "encode" ? model.step : result.payload.step;
  $("keep").value = mode === "encode" ? model.keep : 0;
  $("keep-value").textContent =
    mode === "encode" ? model.keep + "%" : "Imported";
  for (const id of ["levels", "step", "keep"])
    $(id).disabled = mode === "decode";
  for (const id of ["column", "row"]) {
    $(id).max = size - 1;
    $(id).value = Math.min(size - 1, Math.max(0, Number($(id).value) || 0));
  }
}
function paint(canvas, values, size, heat = false) {
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d"),
    data = ctx.createImageData(size, size),
    max = heat ? Math.max(1, ...values.map(Math.abs)) : 255;
  for (let i = 0; i < values.length; i++) {
    if (heat) {
      const t = Math.log1p(Math.abs(values[i])) / Math.log1p(max),
        color = values[i] >= 0 ? [222, 143, 128] : [120, 169, 214];
      for (let c = 0; c < 3; c++)
        data.data[4 * i + c] = Math.round(22 + (color[c] - 22) * t);
    } else for (let c = 0; c < 3; c++) data.data[4 * i + c] = values[i];
    data.data[4 * i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
}
function inspect() {
  if (!ready) return;
  const size = result.payload.size,
    x = Number($("column").value),
    y = Number($("row").value);
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    x >= size ||
    y >= size
  )
    return;
  const i = y * size + x,
    approx = size / 2 ** result.payload.levels;
  $("coefficient-value").textContent =
    `${x < approx && y < approx ? "Approximation" : "Detail"} [${x}, ${y}] · reconstructed coefficient ${Number(result.quantized[i].toPrecision(7))}${mode === "encode" ? " · original " + Number(result.coefficients[i].toPrecision(7)) : ""}`;
}
function render() {
  const size = result.payload.size,
    metrics = result.metrics,
    bytes = new TextEncoder().encode(JSON.stringify(result.payload)).length;
  $("source-label").textContent =
    mode === "encode"
      ? sourceLabel
      : `Source unavailable · imported ${size}×${size}`;
  if (mode === "encode") paint($("source"), model.pixels, size);
  else {
    $("source").width = $("source").height = size;
    $("source").getContext("2d").clearRect(0, 0, size, size);
  }
  paint($("coefficients"), result.quantized, size, true);
  paint($("reconstruction"), result.pixels, size);
  $("metrics").replaceChildren(
    ...[
      [
        "Nonzero coefficients",
        result.payload.coefficients.length.toLocaleString() +
          " / " +
          (size * size).toLocaleString(),
      ],
      ["Coefficient JSON", (bytes / 1024).toFixed(1) + " KiB"],
      ["Pixel MSE", metrics ? metrics.mse.toFixed(3) : "Unknown"],
      [
        "Pixel PSNR",
        metrics
          ? metrics.mse === 0
            ? "Exact bytes"
            : metrics.psnr.toFixed(2) + " dB"
          : "Unknown",
      ],
    ].map(([label, value]) => {
      const p = el("p", label);
      p.prepend(el("b", value));
      return p;
    }),
  );
  $("quality").textContent = metrics
    ? `${metrics.selectedDetails} of ${metrics.detailTotal} detail positions selected, plus all ${metrics.approximationCount} approximation positions. ${result.clipped} pixels lie outside the byte-rounding interval before clipping.`
    : "Source pixels are absent from this coefficient file. MSE, PSNR, and original coefficient errors cannot be calculated.";
  $("energy").textContent = metrics
    ? `Raw image squared error ${metrics.rawSSE.toPrecision(8)} · coefficient squared error ${metrics.coefficientSSE.toPrecision(8)}. Differences at floating-point precision are expected.`
    : `${result.clipped} inverse-transform values lie outside the byte-rounding interval.`;
  controls();
  inspect();
}
worker.onmessage = ({ data }) => {
  if (data.id !== sequence) return;
  if (data.error) {
    message(data.error, true);
    return;
  }
  result = data.result;
  ready = true;
  enabled(true);
  render();
  message(
    mode === "encode"
      ? "Reconstruction ready. File size measures the actual sparse JSON representation."
      : "Coefficient file reconstructed. Source-reference quality is unavailable.",
  );
};
worker.onerror = () =>
  message("Transform worker failed. Reload to restart.", true);
for (const id of ["levels", "step"])
  $(id).onchange = () => {
    if (mode !== "encode") return;
    model[id] = Number($(id).value);
    run();
  };
$("keep").oninput = () => {
  if (mode !== "encode") return;
  model.keep = Number($("keep").value);
  $("keep-value").textContent = model.keep + "%";
  run();
};
for (const id of ["column", "row"]) $(id).oninput = inspect;
$("example").onclick = () => {
  loadSequence++;
  mode = "encode";
  model = example();
  sourceLabel = "Generated study";
  run();
};
$("reuse").onclick = () => {
  if (!ready) return;
  loadSequence++;
  model = {
    size: result.payload.size,
    pixels: [...result.pixels],
    levels: result.payload.levels,
    step: result.payload.step,
    keep: 100,
  };
  mode = "encode";
  sourceLabel = "Previous reconstruction";
  run();
};
function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("save").onclick = () => {
  if (ready)
    download(
      "wavelet-loom-coefficients.json",
      JSON.stringify(result.payload),
      "application/json",
    );
};
$("evidence").onclick = () => {
  if (ready)
    download(
      "wavelet-loom-evidence.json",
      JSON.stringify({ mode, sourceLabel, result }, null, 2) + "\n",
      "application/json",
    );
};
$("png").onclick = () => {
  if (ready)
    $("reconstruction").toBlob((blob) => {
      if (blob) download("wavelet-loom-reconstruction.png", blob, "image/png");
    }, "image/png");
};
$("coeff-open").onclick = () => $("coeff-file").click();
$("coeff-file").onchange = async () => {
  const file = $("coeff-file").files[0];
  $("coeff-file").value = "";
  if (!file) return;
  const load = ++loadSequence;
  try {
    if (file.size > 2000000)
      throw Error("Coefficient file must be at most 2 MB.");
    const parsed = JSON.parse(await file.text());
    if (load !== loadSequence) return;
    mode = "decode";
    model = parsed;
    sourceLabel = "Coefficient import";
    run();
  } catch (error) {
    message(error.message, true);
  }
};
$("image-open").onclick = () => $("image-file").click();
$("image-file").onchange = async () => {
  const file = $("image-file").files[0];
  $("image-file").value = "";
  if (!file) return;
  const load = ++loadSequence;
  let bitmap;
  try {
    if (
      file.size > 8 * 1024 * 1024 ||
      !["image/png", "image/jpeg", "image/webp"].includes(file.type)
    )
      throw Error("Use a PNG, JPEG, or WebP image up to 8 MiB.");
    bitmap = await createImageBitmap(file);
    if (bitmap.width * bitmap.height > 16000000)
      throw Error("Image exceeds 16 million decoded pixels.");
    if (load !== loadSequence) return;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 128, 128);
    const scale = Math.min(128 / bitmap.width, 128 / bitmap.height),
      w = bitmap.width * scale,
      h = bitmap.height * scale;
    ctx.drawImage(bitmap, (128 - w) / 2, (128 - h) / 2, w, h);
    const rgba = ctx.getImageData(0, 0, 128, 128).data,
      pixels = Array.from({ length: 128 * 128 }, (_, i) =>
        Math.round(
          0.2126 * rgba[4 * i] +
            0.7152 * rgba[4 * i + 1] +
            0.0722 * rgba[4 * i + 2],
        ),
      );
    mode = "encode";
    model = { size: 128, pixels, levels: 4, keep: 15, step: 4 };
    sourceLabel = "Imported image · fitted to 128×128";
    run();
  } catch (error) {
    message(error.message, true);
  } finally {
    bitmap?.close();
  }
};
run();
