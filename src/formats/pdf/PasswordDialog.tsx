import { useState } from 'react'

interface Props {
  onClose: () => void
  onApply: (userPassword: string, ownerPassword: string) => void
}

export default function PasswordDialog({ onClose, onApply }: Props) {
  const [userPassword, setUserPassword] = useState('')
  const [ownerPassword, setOwnerPassword] = useState('')
  const [showPasswords, setShowPasswords] = useState(false)

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}>
      <div style={{
        background: 'var(--bg-primary)', borderRadius: 8, padding: 24,
        border: '1px solid var(--border)', minWidth: 380
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Password Protect PDF</h3>
          <button onClick={onClose} style={{ fontSize: 18 }}>✕</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
              Open Password (required to open the PDF)
            </label>
            <input
              type={showPasswords ? 'text' : 'password'}
              value={userPassword}
              onChange={(e) => setUserPassword(e.target.value)}
              placeholder="Enter password..."
              style={{ width: '100%', padding: '6px 8px' }}
            />
          </div>

          <div>
            <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
              Owner Password (required to edit/print — optional)
            </label>
            <input
              type={showPasswords ? 'text' : 'password'}
              value={ownerPassword}
              onChange={(e) => setOwnerPassword(e.target.value)}
              placeholder="Leave blank to use same as open password"
              style={{ width: '100%', padding: '6px 8px' }}
            />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showPasswords} onChange={(e) => setShowPasswords(e.target.checked)} />
            Show passwords
          </label>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ padding: '8px 16px', background: 'var(--bg-surface)', borderRadius: 4 }}>
            Cancel
          </button>
          <button
            onClick={() => onApply(userPassword, ownerPassword || userPassword)}
            disabled={!userPassword}
            style={{
              padding: '8px 16px', background: userPassword ? 'var(--accent)' : 'var(--bg-surface)',
              color: 'var(--bg-primary)', borderRadius: 4, fontWeight: 600,
              opacity: userPassword ? 1 : 0.5
            }}
          >
            Protect PDF
          </button>
        </div>
      </div>
    </div>
  )
}
