import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ImagePrepareError, prepareUploadFile } from "./image-utils";

/**
 * `prepareUploadFile` runs in the browser, so the test supplies the only three
 * platform pieces it touches: `Image` (decode), `document.createElement("canvas")`
 * (re-encode) and `URL.createObjectURL` (preview). No jsdom dependency.
 */
const REAL = {
  Image: globalThis.Image,
  document: (globalThis as { document?: unknown }).document,
  createObjectURL: URL.createObjectURL,
};

function stubDecode(behaviour: "load" | "error") {
  class FakeImage {
    width = 800;
    height = 600;
    onload: (() => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    set src(_value: string) {
      // A real `img.onerror` fires with an Event, not an Error.
      queueMicrotask(() =>
        behaviour === "load" ? this.onload?.() : this.onerror?.(new Event("error")),
      );
    }
  }
  (globalThis as { Image: unknown }).Image = FakeImage;
}

function stubCanvasEncoding() {
  (globalThis as { document: unknown }).document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: () => {} }),
      toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(["jpeg"], { type: "image/jpeg" })),
    }),
  };
}

function file(name: string, type: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe("prepareUploadFile", () => {
  beforeEach(() => {
    URL.createObjectURL = () => "blob:stub";
    URL.revokeObjectURL = () => {};
  });
  afterEach(() => {
    (globalThis as { Image: unknown }).Image = REAL.Image;
    (globalThis as { document: unknown }).document = REAL.document;
    URL.createObjectURL = REAL.createObjectURL;
  });

  // LIB-11 / OCR-11: HEIC used to take the decode path and fail with the
  // generic "something went wrong", although the picker advertises the format.
  it("raises HEIC for a photo this browser cannot decode", async () => {
    stubDecode("error");
    const err = await prepareUploadFile(file("IMG_0001.heic", "image/heic", 1000)).catch((e) => e);
    expect(err).toBeInstanceOf(ImagePrepareError);
    expect(err.code).toBe("HEIC");
  });

  it("raises BAD_IMAGE for bytes that are not an image at all", async () => {
    stubDecode("error");
    const err = await prepareUploadFile(file("notes.jpg", "image/jpeg", 1000)).catch((e) => e);
    expect(err).toBeInstanceOf(ImagePrepareError);
    expect(err.code).toBe("BAD_IMAGE");
  });

  it("rejects with a real Error, not the decode Event", async () => {
    stubDecode("error");
    const err = await prepareUploadFile(file("notes.jpg", "image/jpeg", 1000)).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).not.toBe("");
  });

  // LIB-11(a): the passthrough decision is now capped by bytes as well as
  // pixels, so the client can never hand the route a file it will 413.
  it("re-encodes an over-cap PNG instead of passing it through", async () => {
    stubDecode("load");
    stubCanvasEncoding();
    const overCap = file("screenshot.png", "image/png", 13 * 1024 * 1024);
    const out = await prepareUploadFile(overCap);
    expect(out).not.toBe(overCap);
    expect(out.type).toBe("image/jpeg");
  });

  it("passes a small in-cap image through byte-identical", async () => {
    stubDecode("load");
    stubCanvasEncoding();
    const small = file("screenshot.png", "image/png", 400_000);
    expect(await prepareUploadFile(small)).toBe(small);
  });

  it("keeps a PDF as it is when it fits", async () => {
    const pdf = file("menu.pdf", "application/pdf", 1024 * 1024);
    expect(await prepareUploadFile(pdf)).toBe(pdf);
  });

  it("rejects a PDF over the cap", async () => {
    const err = await prepareUploadFile(
      file("menu.pdf", "application/pdf", 13 * 1024 * 1024),
    ).catch((e) => e);
    expect(err.code).toBe("FILE_TOO_LARGE");
  });
});
