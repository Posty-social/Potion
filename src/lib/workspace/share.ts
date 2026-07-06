const publicLinkTokenPattern = /^pub_[a-f0-9]{32}$/

export function createPublicLinkToken(seed = crypto.randomUUID()) {
  return `pub_${seed.replaceAll('-', '').toLowerCase()}`
}

export function isPublicLinkToken(value: string) {
  return publicLinkTokenPattern.test(value)
}
