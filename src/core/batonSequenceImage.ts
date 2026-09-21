import { colorHex } from "./choreography";
import { usageTime, type BatonChange } from "./batonUsage";
// Small fixed bitmap font for the ASCII timestamps; no external fonts or assets.
const glyphs: Record<string, string[]> = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  ":": ["00000", "00100", "00100", "00000", "00100", "00100", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "00100", "00100"],
  ">": ["00000", "00100", "00010", "11111", "00010", "00100", "00000"],
};
function join(parts: Uint8Array[]) {
  const data = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    data.set(p, offset);
    offset += p.length;
  }
  return data;
}
function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const n of data) {
    crc ^= n;
    for (let b = 0; b < 8; b++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name: string, data: Uint8Array) {
  const kind = new TextEncoder().encode(name);
  const size = new Uint8Array(4),
    crc = new Uint8Array(4);
  new DataView(size.buffer).setUint32(0, data.length);
  new DataView(crc.buffer).setUint32(0, crc32(join([kind, data])));
  return join([size, kind, data, crc]);
}
export async function batonSequenceImage(changes: BatonChange[]) {
  const labels = changes.map((c) => usageTime(c.time));
  const width = Math.max(
      1,
      labels.reduce((n, s) => n + s.length * 9 + 50, 0),
    ),
    height = 32;
  const pixels = new Uint8Array(width * 2 * height * 2 * 4);
  const fill = (x: number, y: number, w: number, h: number, hex: string) => {
    const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    for (
      let yy = Math.max(0, Math.round(y * 2));
      yy < Math.min(height * 2, Math.round((y + h) * 2));
      yy++
    )
      for (
        let xx = Math.max(0, Math.round(x * 2));
        xx < Math.min(width * 2, Math.round((x + w) * 2));
        xx++
      )
        pixels.set([...rgb, 255], (yy * width * 2 + xx) * 4);
  };
  const text = (value: string, x: number) => {
    for (const [i, ch] of [...value].entries())
      for (const [y, row] of glyphs[ch].entries())
        for (let col = 0; col < 5; col++)
          if (row[col] === "1")
            fill(x + i * 9 + col * 1.5, 10 + y * 1.5, 1.5, 1.5, "#34445e");
  };
  let x = 0;
  changes.forEach((c, i) => {
    text(labels[i], x);
    const cx = x + labels[i].length * 9 + 18;
    for (let py = -24; py <= 24; py++)
      for (let px = -24; px <= 24; px++) {
        const hand = px < 0 ? c.left : c.right;
        if (hand === "黑") continue;
        const distance = Math.hypot(px / 2, py / 2);
        if (distance > 11.5) continue;
        const border = distance > 10.5 || Math.abs(px) < 1;
        fill(
          cx + px / 2,
          16 + py / 2,
          0.5,
          0.5,
          border ? "#536277" : colorHex(hand),
        );
      }
    x += labels[i].length * 9 + 50;
    if (i < changes.length - 1) text(">", x - 11);
  });
  const stride = width * 2 * 4,
    scan = new Uint8Array((stride + 1) * height * 2);
  for (let y = 0; y < height * 2; y++)
    scan.set(
      pixels.subarray(y * stride, (y + 1) * stride),
      y * (stride + 1) + 1,
    );
  const compressed = new Uint8Array(
    await new Response(
      new Blob([scan.buffer])
        .stream()
        .pipeThrough(new CompressionStream("deflate")),
    ).arrayBuffer(),
  );
  const header = new Uint8Array(13),
    view = new DataView(header.buffer);
  view.setUint32(0, width * 2);
  view.setUint32(4, height * 2);
  header[8] = 8;
  header[9] = 6;
  const png = join([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", compressed),
    chunk("IEND", new Uint8Array()),
  ]);
  // Chunk conversion avoids argument limits for long replacement lists.
  let binary = "";
  for (let i = 0; i < png.length; i += 8192)
    binary += String.fromCharCode(...png.subarray(i, i + 8192));
  return { base64: `data:image/png;base64,${btoa(binary)}`, width, height };
}
