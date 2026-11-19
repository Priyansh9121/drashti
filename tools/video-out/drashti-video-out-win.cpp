/*
 * drashti-video-out on Windows (x30, prompt 11; the owner's "Go, all A"): the stream's picture to other apps on this
 * computer by Spout (Spout2's SpoutDX, BSD: LICENSES/spout/).
 *
 * Drashti's video-out process starts it while video out is on and writes each frame on its input (frame-input.h).
 * Each frame is turned into BGRA, opaque, and sent by SpoutDX into its shared DirectX 11 texture. Other apps (OBS's
 * Spout plug-in, Resolume, ...) list it under --name. The input's end releases the sender and ends the program.
 *
 *   drashti-video-out.exe --name NAME
 *
 * Says "ready" on its output once DirectX 11 is open; anything wrong on its error output. Built by
 * scripts/fetch-video-out.mjs with Visual Studio's compiler, SpoutDX's sources compiled in.
 */
#include <fcntl.h>
#include <io.h>
#include <stdio.h>
#include <string.h>

#include <vector>

#include "SpoutDX.h"
#include "frame-input.h"

int main(int argc, char *argv[]) {
  const char *name = nullptr;
  for (int i = 1; i + 1 < argc; i++)
    if (strcmp(argv[i], "--name") == 0) name = argv[i + 1];
  if (!name || !*name) {
    fprintf(stderr, "Usage: drashti-video-out --name NAME\n");
    return 2;
  }
  _setmode(_fileno(stdin), _O_BINARY);
  spoutDX sender;
  if (!sender.OpenDirectX11()) {
    fprintf(stderr, "DirectX 11 could not start\n");
    return 3;
  }
  sender.SetSenderName(name);
  sender.SetSenderFormat(DXGI_FORMAT_B8G8R8A8_UNORM);
  printf("ready\n");
  fflush(stdout);
  std::vector<unsigned char> frame, bgra;
  dvo_header h;
  unsigned long sent = 0, failed = 0;
  int got;
  while ((got = dvo_read_header(stdin, &h)) == 1) {
    frame.resize(dvo_bytes(h.format, h.width, h.height));
    if (!dvo_read_all(stdin, frame.data(), frame.size())) break;
    bgra.resize(static_cast<size_t>(h.width) * h.height * 4);
    dvo_to_bgra(&h, frame.data(), bgra.data(), static_cast<size_t>(h.width) * 4);
    if (sender.SendImage(bgra.data(), h.width, h.height))
      sent++;
    else if (failed++ == 0)
      fprintf(stderr, "A frame could not be sent (%ux%u, format %u)\n", h.width, h.height, h.format);
  }
  if (got < 0) fprintf(stderr, "The input was not a frame: stopping\n");
  fprintf(stderr, "Stopping after %lu frames\n", sent);
  sender.ReleaseSender();
  sender.CloseDirectX11();
  return got < 0 ? 4 : 0;
}
