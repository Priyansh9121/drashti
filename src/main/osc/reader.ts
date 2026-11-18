export interface OscArgument {
  type: string;
  value: number | string | bigint | boolean | null | Buffer | OscArgument[];
}

export interface OscMessage {
  address: string;
  arguments: OscArgument[];
  timetag: bigint;
}

export const OSC_LIMITS = { bytes: 16_384, depth: 8, messages: 32, arguments: 64, totalArguments: 256 };

/** Read one untrusted datagram; a bad packet has no partial result. */
export function readOsc(_packet: Uint8Array): OscMessage[] | null {
  return null;
}
