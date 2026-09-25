import { useUsage } from '@/client/features/usage/api'
import { UsageRow } from '@/client/features/usage/UsageRows'

import { SettingsPage, SettingsSection } from './SettingsLayout'

export function UsageSettings() {
  const { data, isPending, isError } = useUsage()
  return (
    <SettingsPage
      title="Usage"
      description="Subscription limits, reset times, and local model availability."
    >
      <SettingsSection>
        {isPending && <p className="px-3.5 py-3 text-sm text-muted-foreground">Checking usage…</p>}
        {isError && <p className="px-3.5 py-3 text-sm text-destructive">Could not load usage.</p>}
        {!isPending && !isError && data?.snapshots.length === 0 && (
          <p className="px-3.5 py-3 text-sm text-muted-foreground">
            No usage has been reported yet. Send a Claude or Codex message to collect it.
          </p>
        )}
        {data?.snapshots.map(snapshot => (
          <UsageRow key={snapshot.id} snapshot={snapshot} />
        ))}
      </SettingsSection>
    </SettingsPage>
  )
}
