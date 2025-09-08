export const joinUrl = (base: string, path: string): string => {
  return new URL(path, base).toString();
};
