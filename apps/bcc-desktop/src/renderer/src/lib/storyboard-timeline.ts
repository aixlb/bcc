/**
 * 返回播放时间所在镜头：取最后一个 timestamp <= currentTime 的下标。
 * timestamps 必须按时间升序；精确落在切点时进入右侧新镜。
 */
export function findActiveTimestampIndex(
  timestamps: readonly number[],
  currentTime: number
): number {
  if (timestamps.length === 0 || !Number.isFinite(currentTime)) return -1
  let lo = 0
  let hi = timestamps.length - 1
  let result = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (timestamps[mid] <= currentTime) {
      result = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return result
}
