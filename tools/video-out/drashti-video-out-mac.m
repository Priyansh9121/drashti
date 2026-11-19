/*
 * drashti-video-out on a Mac (x30, prompt 11; the owner's "Go, all A"): the stream's picture to other apps on this
 * Mac by Syphon (Syphon-Framework, BSD: LICENSES/syphon/).
 *
 * Drashti's video-out process starts it while video out is on and writes each frame on its input (frame-input.h).
 * Each frame is turned into BGRA by Accelerate straight into the Syphon server's shared IOSurface, which is then
 * published: Syphon's own way for a server of its own (SyphonSubclassing.h), with no drawing of its own. Other apps
 * (OBS's Syphon Client, Resolume, ...) list it under --name. The input's end stops the server and the program.
 *
 *   drashti-video-out --name NAME
 *
 * Says "ready" on its output once the server is up; anything wrong on its error output. Built by
 * scripts/fetch-video-out.mjs with the Mac's own clang, Syphon's sources compiled in.
 */
#import <Accelerate/Accelerate.h>
#import <Foundation/Foundation.h>
#import <IOSurface/IOSurface.h>
#import <Syphon/SyphonServerBase.h>
#import <Syphon/SyphonSubclassing.h>

#include "frame-input.h"

@interface DrashtiVideoOut : SyphonServerBase
- (BOOL)publishFrame:(const unsigned char *)data header:(const dvo_header *)h;
@end

@implementation DrashtiVideoOut {
  vImage_YpCbCrToARGB _nv12;
  vImage_YpCbCrToARGB _i420;
}

- (instancetype)initWithName:(NSString *)name options:(NSDictionary<NSString *, id> *)options {
  self = [super initWithName:name options:options];
  if (self) {
    // Video range, BT.709: how Chromium's captures come.
    vImage_YpCbCrPixelRange range = {16, 128, 235, 240, 235, 16, 240, 16};
    if (vImageConvert_YpCbCrToARGB_GenerateConversion(kvImage_YpCbCrToARGBMatrix_ITU_R_709_2, &range, &_nv12,
                                                      kvImage420Yp8_CbCr8, kvImageARGB8888,
                                                      kvImageNoFlags) != kvImageNoError ||
        vImageConvert_YpCbCrToARGB_GenerateConversion(kvImage_YpCbCrToARGBMatrix_ITU_R_709_2, &range, &_i420,
                                                      kvImage420Yp8_Cb8_Cr8, kvImageARGB8888,
                                                      kvImageNoFlags) != kvImageNoError)
      return nil;
  }
  return self;
}

- (BOOL)publishFrame:(const unsigned char *)data header:(const dvo_header *)h {
  size_t w = h->width, ht = h->height, cw = (w + 1) / 2, ch = (ht + 1) / 2;
  IOSurfaceRef surface = [self newSurfaceForWidth:w height:ht options:nil];
  if (!surface) return NO;
  IOSurfaceLock(surface, 0, NULL);
  vImage_Buffer out = {IOSurfaceGetBaseAddress(surface), ht, w, IOSurfaceGetBytesPerRow(surface)};
  // ARGB as Accelerate makes it, put in the surface's BGRA order.
  const uint8_t toBGRA[4] = {3, 2, 1, 0};
  vImage_Error done = kvImageNoError;
  if (h->format == DVO_NV12) {
    vImage_Buffer y = {(void *)data, ht, w, w};
    vImage_Buffer c = {(void *)(data + w * ht), ch, cw, cw * 2};
    done = vImageConvert_420Yp8_CbCr8ToARGB8888(&y, &c, &out, &_nv12, toBGRA, 255, kvImageNoFlags);
  } else if (h->format == DVO_I420) {
    vImage_Buffer y = {(void *)data, ht, w, w};
    vImage_Buffer cb = {(void *)(data + w * ht), ch, cw, cw};
    vImage_Buffer cr = {(void *)(data + w * ht + cw * ch), ch, cw, cw};
    done = vImageConvert_420Yp8_Cb8_Cr8ToARGB8888(&y, &cb, &cr, &out, &_i420, toBGRA, 255, kvImageNoFlags);
  } else {
    // Four bytes a pixel: BGRA as it is, RGBA with its red and blue swapped; opaque either way.
    vImage_Buffer in = {(void *)data, ht, w, w * 4};
    const uint8_t keep[4] = {0, 1, 2, 3}, swap[4] = {2, 1, 0, 3};
    done = vImagePermuteChannels_ARGB8888(&in, &out, h->format == DVO_BGRA ? keep : swap, kvImageNoFlags);
    if (done == kvImageNoError) {
      vImage_Buffer alpha = out;
      done = vImageOverwriteChannelsWithScalar_ARGB8888(255, &alpha, &alpha, 0x1, kvImageNoFlags);
    }
  }
  IOSurfaceUnlock(surface, 0, NULL);
  CFRelease(surface);
  if (done != kvImageNoError) return NO;
  [self publish];
  return YES;
}

@end

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    NSString *name = nil;
    for (int i = 1; i + 1 < argc; i++)
      if (strcmp(argv[i], "--name") == 0) name = [NSString stringWithUTF8String:argv[i + 1]];
    if (name.length == 0) {
      fprintf(stderr, "Usage: drashti-video-out --name NAME\n");
      return 2;
    }
    // Made on the main thread: Syphon answers other apps' questions on its run loop.
    DrashtiVideoOut *server = [[DrashtiVideoOut alloc] initWithName:name options:nil];
    if (!server) {
      fprintf(stderr, "The Syphon server could not start\n");
      return 3;
    }
    printf("ready\n");
    fflush(stdout);
    [NSThread detachNewThreadWithBlock:^{
      dvo_header h;
      unsigned char *frame = NULL;
      size_t room = 0;
      unsigned long sent = 0, failed = 0;
      int got;
      while ((got = dvo_read_header(stdin, &h)) == 1) {
        size_t n = dvo_bytes(h.format, h.width, h.height);
        if (n > room) {
          free(frame);
          frame = malloc(n);
          room = frame ? n : 0;
          if (!frame) break;
        }
        if (!dvo_read_all(stdin, frame, n)) break;
        @autoreleasepool {
          if ([server publishFrame:frame header:&h])
            sent++;
          else if (failed++ == 0)
            fprintf(stderr, "A frame could not be published (%ux%u, format %u)\n", h.width, h.height, h.format);
        }
      }
      if (got < 0) fprintf(stderr, "The input was not a frame: stopping\n");
      free(frame);
      fprintf(stderr, "Stopping after %lu frames\n", sent);
      dispatch_async(dispatch_get_main_queue(), ^{
        [server stop];
        exit(got < 0 ? 4 : 0);
      });
    }];
    [[NSRunLoop mainRunLoop] run];
  }
  return 0;
}
