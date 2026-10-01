export type ProceduralSound = "white" | "pink" | "brown" | "fan" | "ambient";

function clamp(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

export function renderNoiseWav(kind: ProceduralSound, seconds = 2, sampleRate = 22050): Uint8Array {
  const frames = Math.floor(seconds * sampleRate);
  const header = 44;
  const buffer = new ArrayBuffer(header + frames * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + frames * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, frames * 2, true);

  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, brown = 0;
  for (let index = 0; index < frames; index += 1) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;
    brown = clamp((brown + white * 0.02) * 0.98);
    let sample = white;
    if (kind === "pink") sample = pink * 0.11;
    if (kind === "brown") sample = brown;
    if (kind === "fan") sample = brown * 0.7 + Math.sin((2 * Math.PI * 90 * index) / sampleRate) * 0.08;
    if (kind === "ambient") sample = brown * 0.45 + Math.sin((2 * Math.PI * 0.2 * index) / sampleRate) * 0.02;
    view.setInt16(header + index * 2, clamp(sample) * 32767, true);
  }
  return new Uint8Array(buffer);
}
