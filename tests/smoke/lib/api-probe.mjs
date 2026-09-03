// These probes are separated by browser work or a service restart. Close the
// initial auth probe as well as later probes so they leave no idle socket to
// reuse at the Router's keep-alive timeout boundary.
export function getWithoutKeepAlive(request, url) {
  return request.get(url, {
    headers: { connection: 'close' },
    maxRetries: 0,
  });
}
