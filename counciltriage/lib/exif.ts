/**
 * Minimal EXIF GPS reader for JPEG photos (browser and Node: works on an ArrayBuffer).
 *
 * Reads only what the report form needs: GPSLatitude/GPSLongitude and their N/S/E/W refs
 * from the APP1 "Exif" segment. Anything malformed returns null rather than throwing.
 */
export type LatLon = { lat: number; lon: number };

const TAG_GPS_IFD = 0x8825;
const GPS_LAT_REF = 0x0001;
const GPS_LAT = 0x0002;
const GPS_LON_REF = 0x0003;
const GPS_LON = 0x0004;

export function readJpegGps(buffer: ArrayBuffer): LatLon | null {
  try {
    const view = new DataView(buffer);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null; // not a JPEG
    let offset = 2;
    while (offset + 4 <= view.byteLength) {
      const marker = view.getUint16(offset);
      if ((marker & 0xff00) !== 0xff00) return null;
      const size = view.getUint16(offset + 2);
      if (marker === 0xffe1 && view.getUint32(offset + 4) === 0x45786966 /* "Exif" */) {
        return readTiffGps(view, offset + 10);
      }
      if (marker === 0xffda) return null; // image data starts: no EXIF before it
      offset += 2 + size;
    }
    return null;
  } catch {
    return null;
  }
}

function readTiffGps(view: DataView, tiff: number): LatLon | null {
  const little = view.getUint16(tiff) === 0x4949; // "II" = Intel byte order
  const u16 = (o: number) => view.getUint16(o, little);
  const u32 = (o: number) => view.getUint32(o, little);
  if (u16(tiff + 2) !== 42) return null;

  const findTag = (ifd: number, tag: number): number | null => {
    const count = u16(ifd);
    for (let i = 0; i < count; i++) {
      const entry = ifd + 2 + i * 12;
      if (u16(entry) === tag) return entry;
    }
    return null;
  };

  const ifd0 = tiff + u32(tiff + 4);
  const gpsPointer = findTag(ifd0, TAG_GPS_IFD);
  if (gpsPointer === null) return null;
  const gps = tiff + u32(gpsPointer + 8);

  const ref = (tag: number) => {
    const e = findTag(gps, tag);
    return e === null ? null : String.fromCharCode(view.getUint8(e + 8));
  };
  const dms = (tag: number) => {
    const e = findTag(gps, tag);
    if (e === null || u16(e + 2) !== 5 || u32(e + 4) !== 3) return null; // 3 RATIONALs
    const at = tiff + u32(e + 8);
    const r = (k: number) => {
      const den = u32(at + k * 8 + 4);
      return den ? u32(at + k * 8) / den : 0;
    };
    return r(0) + r(1) / 60 + r(2) / 3600;
  };

  const lat = dms(GPS_LAT);
  const lon = dms(GPS_LON);
  if (lat === null || lon === null || (lat === 0 && lon === 0)) return null;
  const point = {
    lat: Math.round((ref(GPS_LAT_REF) === "S" ? -lat : lat) * 1e6) / 1e6,
    lon: Math.round((ref(GPS_LON_REF) === "W" ? -lon : lon) * 1e6) / 1e6,
  };
  return Number.isFinite(point.lat) && Number.isFinite(point.lon) && Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180 ? point : null;
}
