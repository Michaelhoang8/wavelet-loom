import { encode, decode } from "./core.js";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({
      id: data.id,
      result: data.mode === "decode" ? decode(data.model) : encode(data.model),
    });
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message });
  }
};
