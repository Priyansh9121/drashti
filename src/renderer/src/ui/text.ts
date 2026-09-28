/** "1 slide", "2 slides", "1,200 presentations". */
export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n.toLocaleString('en')} ${n === 1 ? one : many}`;
