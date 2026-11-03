// Sign in (Google, GitHub, or an email link) for cloud saves and share links.
import { useState } from 'react';
import { IconBrandGithub, IconBrandGoogle, IconCloud, IconMail, IconX } from '@tabler/icons-react';
import { cloudEnabled, signInWith, signInWithEmail, signOut, useCloud } from '../cloud/cloud';
import { useStore } from '../store/store';

export function AccountModal({ onClose }: { onClose: () => void }) {
  const user = useCloud((c) => c.user);
  const toast = useStore((s) => s.toast);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(`Sign-in failed: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal account-modal" role="dialog" aria-modal="true" aria-label="Account">
        <div className="modal-head">
          <h2>{user ? 'Your account' : 'Sign in'}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <IconX size={16} />
          </button>
        </div>
        <div className="modal-body">
          {!cloudEnabled ? (
            <>
              <p>
                <IconCloud size={15} /> Cloud sync isn't connected on this copy of OnlineCAD, so your projects are saved in this browser only.
              </p>
              <p className="muted">Whoever hosts this site can turn it on with a free Supabase project (see HOSTING.md). You can always download projects as .ocad files from the dashboard.</p>
            </>
          ) : user ? (
            <>
              <div className="account-row">
                <div className="avatar">{(user.email ?? '?')[0].toUpperCase()}</div>
                <div>
                  <strong>{user.email ?? user.user_metadata?.name ?? 'Signed in'}</strong>
                  <div className="muted">Projects sync to the cloud as you work.</div>
                </div>
              </div>
              <button className="btn" disabled={busy} onClick={() => run(async () => (await signOut(), onClose()))}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <p className="muted">Sign in to keep your projects in the cloud, open them on any device, and share them by link. It's free.</p>
              <div className="signin-buttons">
                <button className="btn signin" disabled={busy} onClick={() => run(() => signInWith('google'))}>
                  <IconBrandGoogle size={17} /> Continue with Google
                </button>
                <button className="btn signin" disabled={busy} onClick={() => run(() => signInWith('github'))}>
                  <IconBrandGithub size={17} /> Continue with GitHub
                </button>
              </div>
              <div className="or">or</div>
              {sent ? (
                <p>
                  <IconMail size={15} /> Check {email}: we sent you a sign-in link.
                </p>
              ) : (
                <form
                  className="email-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (email.includes('@')) void run(async () => (await signInWithEmail(email), setSent(true)));
                  }}
                >
                  <input className="input" type="email" required placeholder="you@example.com" value={email} aria-label="Email" onChange={(e) => setEmail(e.target.value)} />
                  <button className="btn primary" disabled={busy}>
                    Email me a link
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
