import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readJpegGps } from "@/lib/exif";
import { choosePhotoLocation, distanceMetres } from "@/lib/photo-location";
import { isInSouthampton } from "@/lib/geo";

const fixture = (name: string) => {
  const b = fs.readFileSync(path.join(__dirname, "fixtures", name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

/** A minimal big-endian ("MM") EXIF JPEG, as many cameras write, for 50.9 N 1.4 W. */
function bigEndianJpeg(): ArrayBuffer {
  const tiff: number[] = [];
  const u16 = (n: number) => tiff.push((n >> 8) & 255, n & 255);
  const u32 = (n: number) => tiff.push((n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255);
  u16(0x4d4d); u16(42); u32(8); // header, IFD0 at 8
  u16(1); u16(0x8825); u16(4); u32(1); u32(26); u32(0); // IFD0: GPS pointer -> 26
  u16(4); // GPS IFD with 4 entries (26 + 2 + 48 + 4 = 80 for data)
  u16(1); u16(2); u32(2); tiff.push(78, 0, 0, 0); // GPSLatitudeRef "N"
  u16(2); u16(5); u32(3); u32(80); // GPSLatitude -> 80
  u16(3); u16(2); u32(2); tiff.push(87, 0, 0, 0); // GPSLongitudeRef "W"
  u16(4); u16(5); u32(3); u32(104); // GPSLongitude -> 104
  u32(0);
  for (const [n, d] of [[50, 1], [54, 1], [0, 1], [1, 1], [24, 1], [0, 1]]) { u32(n); u32(d); }
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const bytes = [0xff, 0xd8, 0xff, 0xe1, ((app1.length + 2) >> 8) & 255, (app1.length + 2) & 255, ...app1, 0xff, 0xd9];
  return new Uint8Array(bytes).buffer;
}

describe("EXIF GPS reader", () => {
  it("reads the location written by a camera or phone (little-endian)", () => {
    const p = readJpegGps(fixture("gps-the-avenue.jpg"));
    expect(p?.lat).toBeCloseTo(50.9226, 4);
    expect(p?.lon).toBeCloseTo(-1.4048, 4);
  });

  it("reads big-endian EXIF too", () => {
    const p = readJpegGps(bigEndianJpeg());
    expect(p?.lat).toBeCloseTo(50.9, 4);
    expect(p?.lon).toBeCloseTo(-1.4, 4);
  });

  it("returns null for photos without GPS and for non-JPEG data", () => {
    expect(readJpegGps(fixture("no-gps.jpg"))).toBeNull();
    expect(readJpegGps(new TextEncoder().encode("not an image").buffer as ArrayBuffer)).toBeNull();
    expect(readJpegGps(new ArrayBuffer(0))).toBeNull();
  });
});

describe("choosing the report location from photos", () => {
  const avenue = readJpegGps(fixture("gps-the-avenue.jpg"));
  const avenue2 = readJpegGps(fixture("gps-the-avenue-2.jpg"));
  const bitterne = readJpegGps(fixture("gps-bitterne.jpg"));
  const london = readJpegGps(fixture("gps-london.jpg"));

  it("uses a single photo's location when it is in Southampton", () => {
    expect(choosePhotoLocation([avenue], isInSouthampton)).toMatchObject({ source: "photo", point: avenue });
  });

  it("uses the first photo when several agree", () => {
    expect(distanceMetres(avenue!, avenue2!)).toBeLessThan(20);
    expect(choosePhotoLocation([avenue, null, avenue2], isInSouthampton)).toMatchObject({ source: "photo", point: avenue, photos: 2 });
  });

  it("keeps the resident's map choice when photos were taken far apart", () => {
    const d = choosePhotoLocation([avenue, bitterne], isInSouthampton);
    expect(d).toMatchObject({ source: "map", reason: "photos_disagree" });
    expect(d.source === "map" && d.spreadMetres).toBeGreaterThan(1000);
  });

  it("ignores photo locations outside Southampton, and photos without GPS", () => {
    expect(choosePhotoLocation([london], isInSouthampton)).toMatchObject({ source: "map", reason: "outside_area" });
    expect(choosePhotoLocation([london, avenue], isInSouthampton)).toMatchObject({ source: "photo", point: avenue });
    expect(choosePhotoLocation([null, null], isInSouthampton)).toMatchObject({ source: "map", reason: "no_gps" });
  });
});
