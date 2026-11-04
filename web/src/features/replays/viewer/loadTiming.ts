// Map-loading stages in the browser's Performance panel; durations include any awaited work.
export async function measureMapLoad<T>(
  stage: string,
  mapName: string,
  work: () => T | Promise<T>,
): Promise<T> {
  const start = performance.now();
  const result = await work();
  performance.measure(`replay:${stage}`, { start, detail: { mapName } });
  return result;
}
