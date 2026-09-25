import { useEffect, useRef, useState } from 'react'

import { IconCopy, IconPlus, IconRefresh, IconTerminal2, IconTrash } from '@tabler/icons-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

import { requestJson, requestVoid, jsonRequest } from '@/client/api/http'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/client/components/ui/alert-dialog'
import { Button } from '@/client/components/ui/button'
import { Input } from '@/client/components/ui/input'
import { useWorkspaceId } from '@/client/features/workspace/WorkspaceContext'

type TerminalInfo = { id: string; workspaceId: string; name: string; createdAt: number }

type TerminalViewProps = { workspaceId: string; terminalId: string }

function TerminalView({ workspaceId, terminalId }: TerminalViewProps) {
  const host = useRef<HTMLDivElement>(null)
  const terminal = useRef<Terminal | null>(null)
  const socket = useRef<WebSocket | null>(null)
  const [connection, setConnection] = useState('Connecting…')
  const [notice, setNotice] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [paste, setPaste] = useState('')

  useEffect(() => {
    if (!host.current) return
    const colors = getComputedStyle(host.current)
    const screen = new Terminal({
      cursorBlink: true,
      scrollback: 3000,
      fontSize: 13,
      convertEol: true,
      theme: { background: colors.backgroundColor, foreground: colors.color }
    })
    const fit = new FitAddon()
    screen.loadAddon(fit)
    screen.open(host.current)
    terminal.current = screen
    const url = new URL('/api/terminals/ws', window.location.href)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('workspaceId', workspaceId)
    url.searchParams.set('terminalId', terminalId)
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    socket.current = ws
    const resize = () => {
      fit.fit()
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: 'resize', cols: screen.cols, rows: screen.rows }))
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host.current)
    const input = screen.onData(data => {
      if (ws.readyState === WebSocket.OPEN) ws.send(new TextEncoder().encode(data))
    })
    ws.onopen = () => {
      setConnection('Connected')
      resize()
      screen.focus()
    }
    ws.onmessage = event => screen.write(new Uint8Array(event.data as ArrayBuffer))
    ws.onerror = () => setConnection('Connection failed')
    ws.onclose = () => setConnection('Disconnected')
    return () => {
      input.dispose()
      observer.disconnect()
      ws.onclose = null
      ws.close()
      socket.current = null
      terminal.current = null
      screen.dispose()
    }
  }, [workspaceId, terminalId, attempt])

  function copy() {
    const value = terminal.current?.getSelection()
    if (!value) return
    if (!navigator.clipboard) {
      setNotice('Copy is unavailable over HTTP. Select text in the terminal instead.')
      return
    }
    void navigator.clipboard
      .writeText(value)
      .catch(() => setNotice('Copy is unavailable over HTTP. Select text in the terminal instead.'))
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span aria-live="polite">{connection}</span>
        {notice && <span role="status">{notice}</span>}
        {connection === 'Disconnected' && (
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => {
              setConnection('Connecting…')
              setAttempt(value => value + 1)
            }}
          >
            Reattach
          </Button>
        )}
        <Button
          type="button"
          size="xs"
          variant="ghost"
          onClick={copy}
          disabled={connection !== 'Connected'}
          aria-label="Copy terminal selection"
        >
          <IconCopy stroke={1.75} /> Copy selection
        </Button>
      </div>
      <div
        ref={host}
        className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-md bg-background p-2 ring-1 ring-border"
        aria-label="Terminal"
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="xs"
          variant="ghost"
          onClick={() => setPaste('codex login --device-auth\n')}
        >
          Use Codex login
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          onClick={() => setPaste('claude auth login\n')}
        >
          Use Claude login
        </Button>
      </div>
      <form
        className="flex gap-2"
        onSubmit={event => {
          event.preventDefault()
          if (socket.current?.readyState === WebSocket.OPEN && paste) {
            socket.current.send(new TextEncoder().encode(paste))
            setPaste('')
            terminal.current?.focus()
          }
        }}
      >
        <Input
          value={paste}
          onChange={event => setPaste(event.target.value)}
          aria-label="Paste text into terminal"
          placeholder="Paste text here on mobile"
        />
        <Button type="submit" size="sm" disabled={!paste || connection !== 'Connected'}>
          Send text
        </Button>
      </form>
    </div>
  )
}

export function TerminalPage() {
  const workspaceId = useWorkspaceId()
  const queryClient = useQueryClient()
  const queryKey = ['terminals', workspaceId] as const
  const { data, isPending, error } = useQuery<TerminalInfo[]>({
    queryKey,
    queryFn: () => requestJson(`/api/workspaces/${workspaceId}/terminals`),
    retry: false
  })
  const [selected, setSelected] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const active = data?.find(item => item.id === selected) ?? data?.[0]

  async function create() {
    setBusy(true)
    setActionError('')
    try {
      const result = await requestJson<TerminalInfo>(
        `/api/workspaces/${workspaceId}/terminals`,
        jsonRequest('POST', {})
      )
      await queryClient.invalidateQueries({ queryKey })
      setSelected(result.id)
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not create terminal')
    } finally {
      setBusy(false)
    }
  }

  async function rename() {
    if (!active || !name.trim()) return
    setBusy(true)
    try {
      await requestJson(
        `/api/workspaces/${workspaceId}/terminals/${active.id}`,
        jsonRequest('PATCH', { name: name.trim() })
      )
      setName('')
      await queryClient.invalidateQueries({ queryKey })
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not rename terminal')
    } finally {
      setBusy(false)
    }
  }

  async function kill() {
    if (!active) return
    setBusy(true)
    try {
      await requestVoid(`/api/workspaces/${workspaceId}/terminals/${active.id}`, {
        method: 'DELETE'
      })
      setSelected(null)
      await queryClient.invalidateQueries({ queryKey })
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not stop terminal')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <IconTerminal2 size={20} stroke={1.5} />
        <h2 className="mr-auto text-sm font-medium">Terminal</h2>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void queryClient.invalidateQueries({ queryKey })}
          aria-label="Refresh terminals"
        >
          <IconRefresh stroke={1.75} />
        </Button>
        <Button type="button" size="sm" onClick={() => void create()} disabled={busy || !!error}>
          <IconPlus stroke={1.75} /> New terminal
        </Button>
      </div>
      {isPending && <p className="text-sm text-muted-foreground">Loading terminals…</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error.message}. Enable authenticated Tailscale access and install tmux on the server.
        </p>
      )}
      {actionError && (
        <p role="alert" className="text-sm text-destructive">
          {actionError}
        </p>
      )}
      {data && (
        <div className="flex flex-wrap gap-2">
          {data.map(item => (
            <Button
              key={item.id}
              type="button"
              size="sm"
              variant={active?.id === item.id ? 'secondary' : 'ghost'}
              onClick={() => setSelected(item.id)}
            >
              {item.name}
            </Button>
          ))}
        </div>
      )}
      {active ? (
        <>
          <div className="flex flex-wrap gap-2">
            <form
              className="flex gap-2"
              onSubmit={event => {
                event.preventDefault()
                void rename()
              }}
            >
              <Input
                value={name}
                onChange={event => setName(event.target.value)}
                placeholder={active.name}
                aria-label="Rename terminal"
                maxLength={80}
              />
              <Button type="submit" size="sm" variant="outline" disabled={!name.trim() || busy}>
                Rename
              </Button>
            </form>
            <AlertDialog>
              <AlertDialogTrigger
                render={<Button type="button" size="sm" variant="destructive" />}
                disabled={busy}
              >
                <IconTrash stroke={1.75} /> Stop terminal
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Stop {active.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Its shell and running commands will end. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={() => void kill()}>
                    Stop terminal
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
          <TerminalView key={active.id} workspaceId={workspaceId} terminalId={active.id} />
        </>
      ) : (
        data && (
          <p className="text-sm text-muted-foreground">
            Create a terminal to install CLIs or sign in. The shell stays open when this tab closes.
          </p>
        )
      )}
      <p className="text-xs text-muted-foreground">
        Sign in on this server: <code className="font-mono">codex login --device-auth</code> or{' '}
        <code className="font-mono">claude auth login</code>. Open any printed URL on your own
        device and paste a code if prompted.
      </p>
    </div>
  )
}
