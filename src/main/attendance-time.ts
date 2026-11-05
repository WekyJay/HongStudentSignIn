/** 截止秒仍算准时，超过截止时刻才算迟到。 */
export function isLate(signedAt: string, lateAt?: string): boolean {
  return Boolean(lateAt && Date.parse(signedAt) > Date.parse(lateAt))
}
