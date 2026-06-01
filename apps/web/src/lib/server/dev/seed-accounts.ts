export const DEV_ACCOUNT_UUIDS = [
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000005',
] as const

export type DevAccountUUID = (typeof DEV_ACCOUNT_UUIDS)[number]

export interface DevAccount {
  id: DevAccountUUID
  email: string
  displayName: string
  namespaceSlug: string // for k8s namespace: 'u-{namespaceSlug}'
}

export const DEV_ACCOUNTS: readonly DevAccount[] = [
  { id: '00000000-0000-0000-0000-000000000001', email: 'admin@dev.local',     displayName: 'Dev Admin',      namespaceSlug: 'dev-admin'     },
  { id: '00000000-0000-0000-0000-000000000002', email: 'user1@dev.local',     displayName: 'Dev User 1',     namespaceSlug: 'dev-user1'     },
  { id: '00000000-0000-0000-0000-000000000003', email: 'user2@dev.local',     displayName: 'Dev User 2',     namespaceSlug: 'dev-user2'     },
  { id: '00000000-0000-0000-0000-000000000004', email: 'orgowner@dev.local',  displayName: 'Dev Org Owner',  namespaceSlug: 'dev-orgowner'  },
  { id: '00000000-0000-0000-0000-000000000005', email: 'orgmember@dev.local', displayName: 'Dev Org Member', namespaceSlug: 'dev-orgmember' },
]
