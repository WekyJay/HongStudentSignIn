export function isValidMainlandIdCard(value: string): boolean {
  if (!/^\d{17}[\dX]$/i.test(value)) return false
  const birth = value.slice(6, 14)
  const year = Number(birth.slice(0, 4))
  const month = Number(birth.slice(4, 6))
  const day = Number(birth.slice(6, 8))
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return false
  }
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const checks = '10X98765432'
  const sum = weights.reduce((total, weight, index) => total + Number(value[index]) * weight, 0)
  return value[17].toUpperCase() === checks[sum % 11]
}
