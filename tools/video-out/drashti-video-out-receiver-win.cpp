/*
 * drashti-video-out-receiver on Windows (x30): the end-to-end tests' receiver, never shipped. A Spout receiver, as
 * other apps are: it takes each frame of the sender named --name on this computer and writes what it saw to --out (as
 * the tests' stand-in receiver does, src/main/video-out/stand-in.ts): how many frames, their size, the mean colour of
 * the middle and of the top and bottom quarters' middles, and when. Built by scripts/fetch-video-out.mjs.
 *
 *   drashti-video-out-receiver.exe --name NAME --out FILE
 */
#include <stdio.h>
#include <string.h>
#include <sys/timeb.h>

#include <vector>

#include "SpoutDX.h"

static const char *wanted;
static const char *outFile;
static unsigned long frames;

/* The mean R, G, B of an 8 x 8 square centred at (cx, cy); bgra: the pixels' order is B, G, R, A. */
static void mean(const unsigned char *px, unsigned w, unsigned h, unsigned cx, unsigned cy, bool bgra, int rgb[3]) {
  long sum[3] = {0, 0, 0};
  int n = 0;
  for (unsigned y = cy > 4 ? cy - 4 : 0; y < cy + 4 && y < h; y++)
    for (unsigned x = cx > 4 ? cx - 4 : 0; x < cx + 4 && x < w; x++) {
      const unsigned char *p = px + (static_cast<size_t>(y) * w + x) * 4;
      sum[0] += bgra ? p[2] : p[0];
      sum[1] += p[1];
      sum[2] += bgra ? p[0] : p[2];
      n++;
    }
  for (int i = 0; i < 3; i++) rgb[i] = n ? static_cast<int>(sum[i] / n) : 0;
}

static void seen(const unsigned char *px, unsigned w, unsigned h, bool bgra) {
  int mid[3], top[3], bottom[3];
  mean(px, w, h, w / 2, h / 2, bgra, mid);
  mean(px, w, h, w / 2, h / 4, bgra, top);
  mean(px, w, h, w / 2, h * 3 / 4, bgra, bottom);
  frames++;
  struct _timeb now;
  _ftime_s(&now);
  char text[512];
  int len = snprintf(text, sizeof text,
                     "{\"name\":\"%s\",\"frames\":%lu,\"width\":%u,\"height\":%u,\"format\":\"BGRA\","
                     "\"middle\":[%d,%d,%d],\"top\":[%d,%d,%d],\"bottom\":[%d,%d,%d],\"at\":%lld}",
                     wanted, frames, w, h, mid[0], mid[1], mid[2], top[0], top[1], top[2], bottom[0], bottom[1],
                     bottom[2], static_cast<long long>(now.time) * 1000 + now.millitm);
  FILE *f = nullptr;
  if (fopen_s(&f, outFile, "wb") == 0 && f) {
    fwrite(text, 1, static_cast<size_t>(len), f);
    fclose(f);
  }
}

int main(int argc, char *argv[]) {
  for (int i = 1; i + 1 < argc; i++) {
    if (strcmp(argv[i], "--name") == 0) wanted = argv[i + 1];
    if (strcmp(argv[i], "--out") == 0) outFile = argv[i + 1];
  }
  if (!wanted || !outFile) {
    fprintf(stderr, "Usage: drashti-video-out-receiver --name NAME --out FILE\n");
    return 2;
  }
  spoutDX receiver;
  if (!receiver.OpenDirectX11()) {
    fprintf(stderr, "DirectX 11 could not start\n");
    return 3;
  }
  receiver.SetReceiverName(wanted);
  printf("ready\n");
  fflush(stdout);
  std::vector<unsigned char> pixels;
  unsigned w = 0, h = 0;
  bool connected = false;
  for (;;) {
    if (receiver.ReceiveImage(pixels.empty() ? nullptr : pixels.data(), w, h)) {
      if (receiver.IsUpdated()) {
        // A sender came, or changed size: the buffer follows it.
        w = receiver.GetSenderWidth();
        h = receiver.GetSenderHeight();
        pixels.assign(static_cast<size_t>(w) * h * 4, 0);
        if (!connected) fprintf(stderr, "Connected to %s (%ux%u)\n", wanted, w, h);
        connected = true;
      } else if (!pixels.empty() && receiver.IsFrameNew()) {
        // ReceiveImage reads the frame before (two staging textures, one behind): read once more for this one.
        receiver.ReadTexurePixels(receiver.GetSenderTexture(), pixels.data());
        seen(pixels.data(), w, h, receiver.GetSenderFormat() != DXGI_FORMAT_R8G8B8A8_UNORM);
      }
    }
    Sleep(5);
  }
}
