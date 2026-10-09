import { describe, expect, it } from 'vitest';
import { MAC_AUTHORITIES, streamAuthorities } from './tls';
import { connectionArgs, connectionMessage } from './worker/pipeline';

const there = () => true;
const missing = () => false;

describe('the stream server’s certificate (Session 23)', () => {
  it('on macOS, a secure connection is given the system’s certificate authorities', () => {
    const caFile = streamAuthorities('darwin', there);
    expect(caFile).toBe('/etc/ssl/cert.pem');
    expect(caFile).toBe(MAC_AUTHORITIES);
    const args = connectionArgs('rtmps://a.rtmps.youtube.com:443/live2/k', caFile);
    // An output option: after the input, right before the address.
    expect(args.slice(-3)).toEqual([
      '-ca_file',
      '/etc/ssl/cert.pem',
      'rtmps://a.rtmps.youtube.com:443/live2/k',
    ]);
    expect(args.indexOf('-ca_file')).toBeGreaterThan(args.indexOf('pipe:0'));
  });

  it('never turns the check off', () => {
    for (const caFile of [MAC_AUTHORITIES, null]) {
      const args = connectionArgs('rtmps://a.rtmps.youtube.com/live2/k', caFile).join(' ');
      expect(args).not.toMatch(/tls_verify|verify 0|-verify/u);
    }
  });

  it('on macOS without the file, and on Windows, FFmpeg keeps its own way', () => {
    expect(streamAuthorities('darwin', missing)).toBeNull();
    expect(streamAuthorities('win32', there)).toBeNull();
    expect(connectionArgs('rtmps://a.rtmps.youtube.com/live2/k', null)).not.toContain('-ca_file');
  });

  it('plain RTMP is never given an authorities file', () => {
    expect(connectionArgs('rtmp://127.0.0.1:1935/live2/k', MAC_AUTHORITIES)).not.toContain('-ca_file');
  });

  it('a certificate that could not be checked is said in plain words, not as a dropped connection', () => {
    const lines = [
      '[tls @ 0x1] error:0A000086:SSL routines::certificate verify failed',
      '[rtmps @ 0x2] Cannot open connection tls://a.rtmps.youtube.com:443',
      'Error opening output files: Input/output error',
    ];
    expect(connectionMessage(lines)).toBe(
      'The stream server’s certificate could not be checked, so nothing was sent. Check that this computer’s date and time are right.',
    );
    // GnuTLS's words (the Windows FFmpeg, seen on CI on 10 Oct 2026).
    expect(
      connectionMessage([
        '[tls @ 0000022e507a5d80] Peer certificate failed verification',
        'Error opening output files: I/O error',
      ]),
    ).toMatch(/^The stream server’s certificate could not be checked/u);
    expect(connectionMessage(['Error opening output files: Input/output error'])).toBe(
      'The connection to YouTube dropped.',
    );
  });
});
