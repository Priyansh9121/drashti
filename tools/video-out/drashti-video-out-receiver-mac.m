/*
 * drashti-video-out-receiver on a Mac (x30): the end-to-end tests' receiver, never shipped. A Syphon client, as other
 * apps are: it finds the server named --name on this Mac, takes each frame it publishes, and writes what it saw to
 * --out (as the tests' stand-in receiver does, src/main/video-out/stand-in.ts): how many frames, their size, the mean
 * colour of the middle and of the top and bottom quarters' middles, and when. Built by scripts/fetch-video-out.mjs.
 *
 *   drashti-video-out-receiver --name NAME --out FILE
 */
#import <Foundation/Foundation.h>
#import <IOSurface/IOSurface.h>
#import <Syphon/SyphonClientBase.h>
#import <Syphon/SyphonServerDirectory.h>
#import <Syphon/SyphonSubclassing.h>

#include <sys/time.h>

@interface DrashtiReceiver : SyphonClientBase
@end

@implementation DrashtiReceiver
- (void)invalidateFrame {
  // Nothing kept between frames.
}
@end

static NSString *wanted;
static const char *outFile;
static DrashtiReceiver *client;
static unsigned long frames;

/* The mean B, G, R of an 8 x 8 square centred at (cx, cy). */
static void mean(const unsigned char *base, size_t stride, size_t w, size_t h, size_t cx, size_t cy, int rgb[3]) {
  long sum[3] = {0, 0, 0};
  int n = 0;
  for (size_t y = cy > 4 ? cy - 4 : 0; y < cy + 4 && y < h; y++)
    for (size_t x = cx > 4 ? cx - 4 : 0; x < cx + 4 && x < w; x++) {
      const unsigned char *p = base + y * stride + x * 4;
      sum[0] += p[2];
      sum[1] += p[1];
      sum[2] += p[0];
      n++;
    }
  for (int i = 0; i < 3; i++) rgb[i] = n ? (int)(sum[i] / n) : 0;
}

static void seen(IOSurfaceRef surface) {
  IOSurfaceLock(surface, kIOSurfaceLockReadOnly, NULL);
  const unsigned char *base = IOSurfaceGetBaseAddress(surface);
  size_t stride = IOSurfaceGetBytesPerRow(surface), w = IOSurfaceGetWidth(surface), h = IOSurfaceGetHeight(surface);
  int mid[3], top[3], bottom[3];
  mean(base, stride, w, h, w / 2, h / 2, mid);
  mean(base, stride, w, h, w / 2, h / 4, top);
  mean(base, stride, w, h, w / 2, h * 3 / 4, bottom);
  IOSurfaceUnlock(surface, kIOSurfaceLockReadOnly, NULL);
  frames++;
  struct timeval tv;
  gettimeofday(&tv, NULL);
  char text[512];
  int len = snprintf(text, sizeof text,
                     "{\"name\":\"%s\",\"frames\":%lu,\"width\":%zu,\"height\":%zu,\"format\":\"BGRA\","
                     "\"middle\":[%d,%d,%d],\"top\":[%d,%d,%d],\"bottom\":[%d,%d,%d],\"at\":%lld}",
                     wanted.UTF8String, frames, w, h, mid[0], mid[1], mid[2], top[0], top[1], top[2], bottom[0],
                     bottom[1], bottom[2], (long long)tv.tv_sec * 1000 + tv.tv_usec / 1000);
  FILE *f = fopen(outFile, "wb");
  if (f) {
    fwrite(text, 1, (size_t)len, f);
    fclose(f);
  }
}

/* Connect to the server named as wanted, when there is one and no working client. */
static void look(void) {
  if (client && client.isValid) return;
  client = nil;
  for (NSDictionary *d in [[SyphonServerDirectory sharedDirectory] serversMatchingName:wanted appName:nil]) {
    DrashtiReceiver *c = [[DrashtiReceiver alloc] initWithServerDescription:d
                                                                    options:nil
                                                            newFrameHandler:^(id me) {
                                                              IOSurfaceRef s = [(DrashtiReceiver *)me newSurface];
                                                              if (!s) return;
                                                              seen(s);
                                                              CFRelease(s);
                                                            }];
    if (c.isValid) {
      client = c;
      fprintf(stderr, "Connected to %s\n", wanted.UTF8String);
      return;
    }
  }
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    for (int i = 1; i + 1 < argc; i++) {
      if (strcmp(argv[i], "--name") == 0) wanted = [NSString stringWithUTF8String:argv[i + 1]];
      if (strcmp(argv[i], "--out") == 0) outFile = argv[i + 1];
    }
    if (wanted.length == 0 || !outFile) {
      fprintf(stderr, "Usage: drashti-video-out-receiver --name NAME --out FILE\n");
      return 2;
    }
    printf("ready\n");
    fflush(stdout);
    [NSTimer scheduledTimerWithTimeInterval:0.25
                                    repeats:YES
                                      block:^(NSTimer *t) {
                                        look();
                                      }];
    [[NSRunLoop mainRunLoop] run];
  }
  return 0;
}
