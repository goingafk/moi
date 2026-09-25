import { useState } from 'react'
import { Button } from '@/client/components/ui/button'
import { Textarea } from '@/client/components/ui/textarea'
import { sendMessage } from '@/client/features/chat/connection/chat-connection'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/ui-components/card'
import type { ApprovalRequest } from '@/lib/types'

export function ApprovalCard({ request }: { request: ApprovalRequest }) {
  const [note, setNote] = useState('')
  const answer = (decision: 'once' | 'session' | 'deny') =>
    sendMessage({
      type: 'approval:answer',
      workspaceId: request.workspaceId,
      sessionId: request.sessionId,
      requestId: request.id,
      decision,
      ...(decision === 'deny' && note.trim() ? { note: note.trim() } : {})
    })
  return (
    <Card size="sm" role="group" aria-label="Tool approval request">
      <CardHeader>
        <CardTitle>Approval needed: {request.tool}</CardTitle>
        <CardDescription>{request.reason}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {request.command && (
          <pre className="max-h-32 overflow-auto rounded-md bg-muted p-2 text-xs break-all whitespace-pre-wrap">
            {request.command}
          </pre>
        )}
        {request.paths.length > 0 && (
          <p className="text-xs text-muted-foreground">Paths: {request.paths.join(', ')}</p>
        )}
        <Textarea
          aria-label="Optional denial note"
          placeholder="Optional note if you deny"
          value={note}
          onChange={event => setNote(event.target.value)}
          maxLength={500}
        />
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => answer('once')}>
          Allow once
        </Button>
        <Button size="sm" variant="outline" onClick={() => answer('session')}>
          Allow for this chat
        </Button>
        <Button size="sm" variant="destructive" onClick={() => answer('deny')}>
          Deny
        </Button>
      </CardFooter>
    </Card>
  )
}
