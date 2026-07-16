export interface RecruiterRow {
  name: string
  invites: number
  accepted: number
  messages: number
  replies: number
  campaigns: number
}

export interface WeekData {
  id?: number
  label: string
  weekStart?: string // ISO date (YYYY-MM-DD) of the week's Monday; used for monthly grouping
  rows: RecruiterRow[]
}

/** Aggregate all recruiter rows into team totals for a week */
export function aggregateWeek(week: WeekData): {
  invites: number
  accepted: number
  messages: number
  replies: number
} {
  return week.rows.reduce(
    (acc, r) => ({
      invites: acc.invites + r.invites,
      accepted: acc.accepted + r.accepted,
      messages: acc.messages + r.messages,
      replies: acc.replies + r.replies,
    }),
    { invites: 0, accepted: 0, messages: 0, replies: 0 }
  )
}

export function acceptRate(accepted: number, invites: number): number {
  if (!invites) return 0
  return (accepted / invites) * 100
}

export function replyRate(replies: number, messages: number): number {
  if (!messages) return 0
  return (replies / messages) * 100
}

export function fmt1(n: number): string {
  return n.toFixed(1)
}
