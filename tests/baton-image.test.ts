import { it, expect } from "vitest";
import { inflateSync } from "node:zlib";
import { batonSequenceImage } from "../src/core/batonSequenceImage";
it("Excel圆点图为有效PNG，单手未持棒留白且有时间戳", async () => {
  const image = await batonSequenceImage([
    { time: 1.001, kind: "换色", left: "黑", right: "极红", added: 1 },
  ]);
  const png = Buffer.from(image.base64.split(",")[1], "base64");
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const width = png.readUInt32BE(16),
    height = png.readUInt32BE(20);
  expect(width).toBe(image.width * 2);
  expect(height).toBe(64);
  let offset = 8;
  const chunks: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    if (png.toString("ascii", offset + 4, offset + 8) === "IDAT")
      chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const data = inflateSync(Buffer.concat(chunks)),
    stride = width * 4 + 1;
  expect(data.length).toBe(stride * height);
  const pixel = (x: number, y: number) => [
    ...data.subarray(y * stride + 1 + x * 4, y * stride + 1 + x * 4 + 4),
  ];
  const cx = (9 * 9 + 18) * 2;
  expect(pixel(cx - 10, 32)[3]).toBe(0);
  expect(pixel(cx + 10, 32)).toEqual([255, 105, 91, 255]);
  expect([...data].some((n) => n === 255)).toBe(true);
});
