/*
 * Video out (x30): the frames Drashti's video-out process (src/main/video-out/program-sender.ts) writes on the input
 * of drashti-video-out, one after another: a 16-byte header, then the frame's bytes, tightly packed as the stream's
 * page copied them (I420's three planes, NV12's two, or four bytes a pixel).
 *
 *   bytes 0-3   "DVO1"
 *   bytes 4-7   the format: 1 I420, 2 NV12, 3 BGRA, 4 RGBA
 *   bytes 8-11  the width in pixels
 *   bytes 12-15 the height in pixels
 *
 * All little-endian. The input ending (Drashti stopped it, or went) ends the program.
 */
#ifndef DRASHTI_FRAME_INPUT_H
#define DRASHTI_FRAME_INPUT_H

#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

enum { DVO_I420 = 1, DVO_NV12 = 2, DVO_BGRA = 3, DVO_RGBA = 4 };

/* The largest picture taken: 4096 x 4096. */
#define DVO_MAX_SIDE 4096u

typedef struct {
  uint32_t format, width, height;
} dvo_header;

static inline uint32_t dvo_u32(const unsigned char *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

/* Bytes a frame of this format and size holds, or 0 when the format or size is not one taken. */
static inline size_t dvo_bytes(uint32_t format, uint32_t w, uint32_t h) {
  if (w == 0 || h == 0 || w > DVO_MAX_SIDE || h > DVO_MAX_SIDE) return 0;
  size_t cw = (w + 1) / 2, ch = (h + 1) / 2;
  switch (format) {
    case DVO_I420:
    case DVO_NV12:
      return (size_t)w * h + 2 * cw * ch;
    case DVO_BGRA:
    case DVO_RGBA:
      return (size_t)w * h * 4;
    default:
      return 0;
  }
}

/* Read exactly n bytes: 1 when read, 0 at the input's end (or a failed read). */
static inline int dvo_read_all(FILE *in, void *to, size_t n) {
  unsigned char *p = (unsigned char *)to;
  while (n > 0) {
    size_t got = fread(p, 1, n, in);
    if (got == 0) return 0;
    p += got;
    n -= got;
  }
  return 1;
}

/* The next frame's header: 1 when one came, 0 at the input's end, -1 when what came is not a frame header. */
static inline int dvo_read_header(FILE *in, dvo_header *h) {
  unsigned char b[16];
  if (!dvo_read_all(in, b, sizeof b)) return 0;
  if (b[0] != 'D' || b[1] != 'V' || b[2] != 'O' || b[3] != '1') return -1;
  h->format = dvo_u32(b + 4);
  h->width = dvo_u32(b + 8);
  h->height = dvo_u32(b + 12);
  return dvo_bytes(h->format, h->width, h->height) ? 1 : -1;
}

/*
 * One pixel's colour from video's Y, U and V (BT.709, limited range, as Chromium's captures are), as B, G, R: the
 * reference dvo_to_bgra's 2 x 2 blocks give exactly.
 */
static inline void dvo_yuv_to_bgr(int y, int u, int v, unsigned char *bgr) {
  /* Fixed point, 16 bits: 1.164384, 1.792741, 0.213249, 0.532909 and 2.112402, each times 65536. */
  int c = (y - 16) * 76309, d = u - 128, e = v - 128;
  int r = (c + 117489 * e + 32768) >> 16;
  int g = (c - 13975 * d - 34925 * e + 32768) >> 16;
  int b = (c + 138438 * d + 32768) >> 16;
  bgr[0] = (unsigned char)(b < 0 ? 0 : b > 255 ? 255 : b);
  bgr[1] = (unsigned char)(g < 0 ? 0 : g > 255 ? 255 : g);
  bgr[2] = (unsigned char)(r < 0 ? 0 : r > 255 ? 255 : r);
}

static inline unsigned char dvo_clamp(int v) { return (unsigned char)(v < 0 ? 0 : v > 255 ? 255 : v); }

/*
 * The frame as BGRA, opaque, into `out` (rows `stride` bytes apart). Used where the system has no converter of its own
 * (Windows); a Mac uses Accelerate's. 4:2:0 a 2 x 2 block at a time, its colour worked out once for its four pixels
 * (BT.709, limited range, as Chromium's captures are; fixed point, 16 bits).
 */
static inline void dvo_to_bgra(const dvo_header *h, const unsigned char *src, unsigned char *out, size_t stride) {
  uint32_t w = h->width, ht = h->height, cw = (w + 1) / 2, ch = (ht + 1) / 2;
  if (h->format == DVO_BGRA || h->format == DVO_RGBA) {
    int swap = h->format == DVO_RGBA;
    for (uint32_t row = 0; row < ht; row++) {
      const unsigned char *s = src + (size_t)row * w * 4;
      unsigned char *o = out + (size_t)row * stride;
      for (uint32_t x = 0; x < w; x++, o += 4, s += 4) {
        o[0] = swap ? s[2] : s[0];
        o[1] = s[1];
        o[2] = swap ? s[0] : s[2];
        o[3] = 255;
      }
    }
    return;
  }
  const unsigned char *Y = src, *C = src + (size_t)w * ht;
  for (uint32_t row = 0; row < ht; row += 2) {
    const unsigned char *y0 = Y + (size_t)row * w, *y1 = row + 1 < ht ? y0 + w : y0;
    unsigned char *o0 = out + (size_t)row * stride, *o1 = row + 1 < ht ? o0 + stride : NULL;
    const unsigned char *cr = C + (size_t)(row / 2) * (h->format == DVO_I420 ? cw : cw * 2);
    const unsigned char *vr = C + (size_t)cw * ch + (size_t)(row / 2) * cw;
    for (uint32_t x = 0; x < w; x += 2) {
      uint32_t c = x / 2;
      int d = (h->format == DVO_I420 ? cr[c] : cr[2 * c]) - 128;
      int e = (h->format == DVO_I420 ? vr[c] : cr[2 * c + 1]) - 128;
      int rv = 117489 * e + 32768, guv = -13975 * d - 34925 * e + 32768, bu = 138438 * d + 32768;
      for (uint32_t dx = 0; dx < 2 && x + dx < w; dx++) {
        int l0 = (y0[x + dx] - 16) * 76309;
        unsigned char *p = o0 + (size_t)(x + dx) * 4;
        p[0] = dvo_clamp((l0 + bu) >> 16);
        p[1] = dvo_clamp((l0 + guv) >> 16);
        p[2] = dvo_clamp((l0 + rv) >> 16);
        p[3] = 255;
        if (o1) {
          int l1 = (y1[x + dx] - 16) * 76309;
          p = o1 + (size_t)(x + dx) * 4;
          p[0] = dvo_clamp((l1 + bu) >> 16);
          p[1] = dvo_clamp((l1 + guv) >> 16);
          p[2] = dvo_clamp((l1 + rv) >> 16);
          p[3] = 255;
        }
      }
    }
  }
}

#endif
