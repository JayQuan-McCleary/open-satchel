// Email formats: EML (RFC 822), MSG (Outlook), MBOX (Unix mailbox).

import type { FormatHandler } from '../types'
import EmailViewer from './EmailViewer'
import { useFormatStore } from '../../stores/formatStore'

export interface EmailMessage {
  from?: string
  to?: string
  cc?: string
  subject?: string
  date?: string
  html?: string
  text?: string
  attachments?: { name: string; size: number; mimeType?: string }[]
}

export interface EmailFormatState {
  messages: EmailMessage[]
  activeIndex: number
  type: 'eml' | 'msg' | 'mbox'
  raw: Uint8Array
  error?: string
}

async function parseEml(bytes: Uint8Array): Promise<EmailMessage> {
  try {
    const PostalMime = (await import('postal-mime')).default
    const parser = new PostalMime()
    const result: any = await parser.parse(bytes)
    return {
      from: result.from?.address || result.from?.name || '',
      to: (result.to || []).map((a: any) => a.address).join(', '),
      cc: (result.cc || []).map((a: any) => a.address).join(', '),
      subject: result.subject,
      date: result.date,
      html: result.html,
      text: result.text,
      attachments: (result.attachments || []).map((a: any) => ({
        name: a.filename || 'attachment',
        size: a.content?.length || 0,
        mimeType: a.mimeType,
      })),
    }
  } catch (err) {
    return { subject: '[Parse error]', text: (err as Error).message }
  }
}

async function parseMsg(bytes: Uint8Array): Promise<EmailMessage> {
  try {
    const MsgReader = (await import('msgreader')).default
    const reader = new MsgReader(bytes.buffer)
    const data: any = reader.getFileData()
    return {
      from: data.senderEmail || data.senderName || '',
      to: data.recipients?.map((r: any) => r.email).join(', ') || '',
      subject: data.subject,
      date: data.messageDeliveryTime,
      text: data.body,
      html: data.bodyHtml,
      attachments: (data.attachments || []).map((a: any) => ({
        name: a.fileName || 'attachment',
        size: a.contentLength || 0,
      })),
    }
  } catch (err) {
    return { subject: '[MSG parse error]', text: (err as Error).message }
  }
}

async function parseMbox(bytes: Uint8Array): Promise<EmailMessage[]> {
  // mbox format: messages separated by lines starting with "From "
  const text = new TextDecoder().decode(bytes)
  const rawMessages = text.split(/^From .*$/m).filter(m => m.trim())
  const messages: EmailMessage[] = []
  for (const raw of rawMessages.slice(0, 100)) { // cap at 100 messages
    const bytes = new TextEncoder().encode(raw)
    messages.push(await parseEml(bytes))
  }
  return messages
}

export const emailHandler: FormatHandler = {
  format: 'email',
  extensions: ['eml', 'msg'],
  displayName: 'Email',
  icon: '✉',
  Viewer: EmailViewer,

  load: async (tabId, bytes, filePath) => {
    const isMsg = filePath.toLowerCase().endsWith('.msg')
    let messages: EmailMessage[] = []
    try {
      const msg = isMsg ? await parseMsg(bytes) : await parseEml(bytes)
      messages = [msg]
    } catch (err) {
      messages = [{ subject: 'Error', text: (err as Error).message }]
    }
    const state: EmailFormatState = { messages, activeIndex: 0, type: isMsg ? 'msg' : 'eml', raw: bytes }
    useFormatStore.getState().setFormatState(tabId, state)
  },

  save: async (tabId) => {
    const state = useFormatStore.getState().getFormatState<EmailFormatState>(tabId)
    if (!state) throw new Error('No state')
    return state.raw
  },

  cleanup: (tabId) => useFormatStore.getState().clearFormatState(tabId),
  canConvertTo: ['pdf'],
  capabilities: { edit: false, annotate: false, search: true, zoom: false }
}

export const mboxHandler: FormatHandler = {
  format: 'mbox',
  extensions: ['mbox'],
  displayName: 'Mailbox',
  icon: '📬',
  Viewer: EmailViewer,

  load: async (tabId, bytes, _filePath) => {
    const messages = await parseMbox(bytes)
    const state: EmailFormatState = { messages, activeIndex: 0, type: 'mbox', raw: bytes }
    useFormatStore.getState().setFormatState(tabId, state)
  },

  save: async (tabId) => {
    const state = useFormatStore.getState().getFormatState<EmailFormatState>(tabId)
    if (!state) throw new Error('No state')
    return state.raw
  },

  cleanup: (tabId) => useFormatStore.getState().clearFormatState(tabId),
  canConvertTo: [],
  capabilities: { edit: false, annotate: false, search: true, zoom: false }
}
