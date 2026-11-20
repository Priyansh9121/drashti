/** Read a display source in the worker; bounds are established by the accompanying red tests. */
export async function readDisplaySource(
  url: string,
  maxBytes: number,
  fetcher: (url: string) => Promise<Response> = fetch,
): Promise<Blob> {
  void maxBytes;
  return (await fetcher(url)).blob();
}
