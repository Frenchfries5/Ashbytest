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

export const SEED_WEEKS: WeekData[] = [
  {
    label: 'Apr 14–20',
    rows: [
      { name: 'Ralph Betesh', invites: 130, accepted: 24, messages: 58, replies: 7, campaigns: 4 },
      { name: 'Mike Downey', invites: 80, accepted: 18, messages: 36, replies: 8, campaigns: 2 },
      { name: 'Raynaldo Camuy', invites: 50, accepted: 4, messages: 12, replies: 1, campaigns: 1 },
    ],
  },
  {
    label: 'Apr 21–27',
    rows: [
      { name: 'Ralph Betesh', invites: 136, accepted: 26, messages: 62, replies: 8, campaigns: 5 },
      { name: 'Mike Downey', invites: 85, accepted: 20, messages: 39, replies: 9, campaigns: 2 },
      { name: 'Raynaldo Camuy', invites: 55, accepted: 5, messages: 13, replies: 1, campaigns: 1 },
    ],
  },
  {
    label: 'Apr 28–May 4',
    rows: [
      { name: 'Ralph Betesh', invites: 142, accepted: 28, messages: 65, replies: 9, campaigns: 5 },
      { name: 'Mike Downey', invites: 90, accepted: 22, messages: 41, replies: 11, campaigns: 2 },
      { name: 'Raynaldo Camuy', invites: 60, accepted: 5, messages: 15, replies: 1, campaigns: 1 },
    ],
  },
  {
    label: 'May 5–11',
    rows: [
      { name: 'Ralph Betesh', invites: 138, accepted: 30, messages: 68, replies: 10, campaigns: 5 },
      { name: 'Mike Downey', invites: 95, accepted: 25, messages: 44, replies: 13, campaigns: 2 },
      { name: 'Raynaldo Camuy', invites: 70, accepted: 8, messages: 17, replies: 2, campaigns: 1 },
    ],
  },
  {
    label: 'May 11–17',
    rows: [
      { name: 'Ralph Betesh', invites: 150, accepted: 32, messages: 71, replies: 11, campaigns: 6 },
      { name: 'Mike Downey', invites: 100, accepted: 26, messages: 48, replies: 14, campaigns: 2 },
      { name: 'Raynaldo Camuy', invites: 75, accepted: 7, messages: 19, replies: 2, campaigns: 1 },
    ],
  },
]
